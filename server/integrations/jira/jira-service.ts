import { BaseIntegrationService } from '../base/integration-interface.ts';
import {
  WorkItem,
  ProjectInfo,
  BacklogContext,
  SprintInfo,
  ReleaseInfo,
  TestRun,
  BuildInfo,
  RepositoryInfo,
  ConnectionTestResult,
} from '../base/integration-types.ts';
import { JiraConfig, JiraIssue, JiraProject, JiraSprint, JiraVersion, JiraFieldMapping } from './jira-types.ts';
import { mapJiraIssueToWorkItem, mapWorkItemToJiraIssue, mapJiraIssueTypeToDevX } from './jira-mappers.ts';
import { resolveIssueType, type HierarchyCapability, type HierarchyStrategy } from './strategies/hierarchy-strategy';

/**
 * Walk Atlassian Document Format (ADF) JSON and concatenate all `text` nodes
 * into a single plain-text string. Used by `searchIssuesRich` so the agent's
 * semantic-search and complexity intents can reason about issue descriptions
 * without dealing with ADF's nested paragraph/marks/content tree.
 */
function flattenAdf(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenAdf).join(' ');
  if (typeof node === 'object') {
    const n = node as { text?: string; content?: unknown };
    let out = '';
    if (typeof n.text === 'string') out += n.text;
    if (n.content) {
      const inner = flattenAdf(n.content);
      out += (out && inner ? ' ' : '') + inner;
    }
    return out;
  }
  return '';
}

export class JiraService extends BaseIntegrationService {
  private config: JiraConfig;
  private baseUrl: string;
  private headers: Record<string, string>;
  private fieldMapping?: JiraFieldMapping;
  private _hierarchyCapCache: Map<string, HierarchyCapability> = new Map();
  private _strategy?: HierarchyStrategy;
  private _linkTypeCache?: { testsId: string | null; relatesId: string };

  constructor(config: JiraConfig) {
    super();
    this.config = config;
    this.baseUrl = `${config.instanceUrl}/rest/api/3`;
    
    // Ensure email is trimmed and API token is valid
    const email = (config.email || '').trim();
    const apiToken = (config.apiToken || '').trim();
    
    if (!email || !apiToken) {
      throw new Error('Jira configuration is incomplete: email and API token are required');
    }
    
    // Create Basic Auth token: email:apiToken (standard Jira Cloud authentication)
    const authToken = Buffer.from(`${email}:${apiToken}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Force English responses. Without this, Jira honours the authenticating
      // user's profile locale and returns localized field names (e.g. "故事点"
      // instead of "Story Points") and localized error messages, which makes
      // name-based field lookups in getFieldMapping() silently fail.
      'Accept-Language': 'en-US,en;q=0.9',
    };
    
    console.log(`[JiraService] Initialized with instance: ${config.instanceUrl}, projectKey: ${config.projectKey || 'MISSING'}, email: ${email}, token: ${apiToken.slice(0, 5)}...${apiToken.slice(-4)} (${apiToken.length} chars)`);
    
    // Note: projectKey is optional - only required for project-specific operations
    // Operations like getProjects() don't require a projectKey
  }

  private static readonly RETRYABLE_STATUS_CODES = new Set([500, 502, 503]);
  private static readonly MAX_RETRIES = 3;

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Validate config before making request
    if (!this.config.email || !this.config.apiToken) {
      throw new Error('Jira configuration is incomplete: email and API token are required');
    }

    // Ensure instanceUrl doesn't have trailing slash
    const cleanInstanceUrl = this.config.instanceUrl.replace(/\/$/, '');
    const baseUrl = `${cleanInstanceUrl}/rest/api/3`;
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
    
    // Log request details for debugging (partial reveal for diagnostics)
    const tokenPreview = this.config.apiToken ? `${this.config.apiToken.slice(0, 5)}...${this.config.apiToken.slice(-4)} (${this.config.apiToken.length} chars)` : 'MISSING';
    console.log(`[JiraService] ${options.method || 'GET'} ${url} | email=${this.config.email} | token=${tokenPreview}`);
    
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= JiraService.MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.headers,
          ...options.headers,
        },
      });

      // Log response status for write operations to help diagnose push issues
      if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
        console.log(`[JiraService] Response: ${response.status} ${response.statusText} for ${options.method} ${url}`);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = `Jira API error: ${response.status} ${response.statusText}`;
        
        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.errorMessages && errorJson.errorMessages.length > 0) {
            errorMessage += ` - ${errorJson.errorMessages.join(', ')}`;
          } else if (errorJson.message) {
            errorMessage += ` - ${errorJson.message}`;
          } else {
            errorMessage += ` - ${errorBody}`;
          }
        } catch {
          errorMessage += ` - ${errorBody}`;
        }

        // Retry on transient server errors (500/502/503)
        if (JiraService.RETRYABLE_STATUS_CODES.has(response.status) && attempt < JiraService.MAX_RETRIES) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          console.warn(`[JiraService] Transient ${response.status} error (attempt ${attempt}/${JiraService.MAX_RETRIES}), retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          lastError = new Error(errorMessage);
          continue;
        }
        
        console.error(`[JiraService] Request failed: ${errorMessage}`);
        
        if (response.status === 401) {
          throw new Error(`${errorMessage}\n\nPossible causes:\n- Invalid or expired API token\n- Incorrect email address\n- API token does not have required permissions\n- Jira instance requires different authentication method\n\nPlease verify your credentials in Settings and ensure your API token is valid.`);
        }
        
        throw new Error(errorMessage);
      }

      // 204 No Content or 200 with empty body: e.g. POST /issueLink returns success with no body
      if (response.status === 204) {
        return {} as T;
      }
      const text = await response.text();
      if (!text || text.trim() === '') {
        return {} as T;
      }
      if (attempt > 1) {
        console.log(`[JiraService] Request succeeded on attempt ${attempt} for ${options.method || 'GET'} ${url}`);
      }
      return JSON.parse(text) as T;
    }

    throw lastError || new Error(`Jira API request failed after ${JiraService.MAX_RETRIES} retries`);
  }

  private async agileRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.instanceUrl}/rest/agile/1.0${endpoint}`;
    return this.request<T>(url, options);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      // Step 1: Verify authentication by calling /myself (true auth check)
      // /project/search can return results without auth on some Jira instances
      let accountId: string | undefined;
      try {
        const user = await this.request<{ accountId: string; displayName: string; emailAddress?: string }>('/myself');
        accountId = user?.accountId;
        console.log(`[JiraService] Auth verified via /myself: ${user?.displayName} (${accountId})`);
      } catch (myselfError: any) {
        // /myself failed — try /serverInfo as absolute fallback
        console.warn(`[JiraService] /myself failed (${myselfError.message}), trying /serverInfo...`);
        try {
          await this.request('/serverInfo');
          // serverInfo worked, auth may still be ok in some setups
          console.log('[JiraService] /serverInfo succeeded — treating as connected');
        } catch (serverInfoError: any) {
          // Both endpoints failed — definitely not authenticated
          return {
            success: false,
            message: `Authentication failed: ${myselfError.message}. Please check your email and API token.`,
          };
        }
      }

      // Step 2: Count projects (informational only)
      let projectCount = 0;
      try {
        const projects = await this.request<{ total?: number; values?: any[] }>('/project/search?maxResults=1');
        projectCount = projects.total ?? projects.values?.length ?? 0;
      } catch {
        // Non-fatal — auth already confirmed above
      }

      return {
        success: true,
        message: `Connected successfully. ${projectCount > 0 ? `Found ${projectCount} project(s).` : 'No projects visible (check Browse Projects permission).'}`,
        details: { projectCount },
      };
    } catch (error: any) {
      console.error(`[JiraService] Connection test failed:`, error.message);
      return {
        success: false,
        message: error.message || 'Failed to connect to Jira',
      };
    }
  }

  async getProjects(): Promise<ProjectInfo[]> {
    const toProjectInfo = (p: any): ProjectInfo | null => {
      if (!p) return null;
      const id =
        typeof p.id === "string" || typeof p.id === "number"
          ? String(p.id)
          : "";
      const key = typeof p.key === "string" ? p.key : undefined;
      const name = typeof p.name === "string" ? p.name : key || id;
      if (!name) return null;
      return {
        id,
        name,
        key,
        description:
          typeof p.description === "string" ? p.description : undefined,
      };
    };

    const dedupe = (items: ProjectInfo[]): ProjectInfo[] => {
      const seen = new Set<string>();
      const out: ProjectInfo[] = [];
      for (const item of items) {
        const key = (item.key || item.id || item.name || "").toUpperCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };

    // Primary path: Jira Cloud search endpoint.
    try {
      const rows: any[] = [];
      let startAt = 0;
      const maxResults = 100;

      while (true) {
        const response = await this.request<any>(
          `/project/search?startAt=${startAt}&maxResults=${maxResults}`,
        );
        const values = Array.isArray(response)
          ? response
          : Array.isArray(response?.values)
            ? response.values
            : Array.isArray(response?.projects)
              ? response.projects
              : [];

        rows.push(...values);

        const total = typeof response?.total === "number" ? response.total : rows.length;
        if (Array.isArray(response) || response?.isLast || values.length === 0 || rows.length >= total) {
          break;
        }
        startAt += values.length;
      }

      const mapped = dedupe(rows.map(toProjectInfo).filter((p): p is ProjectInfo => !!p));
      if (mapped.length > 0) {
        return mapped;
      }
      console.warn("[JiraService] /project/search returned 0 projects; trying /project fallback.");
    } catch (error) {
      console.warn(
        `[JiraService] /project/search failed, trying fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Fallback for Jira variants returning projects from legacy endpoint.
    try {
      const legacy = await this.request<any>("/project");
      const rows = Array.isArray(legacy)
        ? legacy
        : Array.isArray(legacy?.values)
          ? legacy.values
          : [];
      return dedupe(
        rows
          .map((p: any) => toProjectInfo(p))
          .filter((p: ProjectInfo | null): p is ProjectInfo => !!p),
      );
    } catch (error) {
      console.warn(
        `[JiraService] /project fallback failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return [];
  }

  /**
   * Lightweight JQL search helper for agent-style queries.
   * Returns up to maxResults issues with key + summary + status + type.
   */
  async searchIssuesByJql(
    jql: string,
    maxResults = 15,
  ): Promise<Array<{ id?: string; key?: string; title?: string; status?: string; type?: string }>> {
    const resp = await this.request<any>(`/search/jql`, {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ["summary", "status", "issuetype"],
      }),
    });
    const issues: any[] = Array.isArray(resp?.issues) ? resp.issues : [];
    return issues.map((it) => ({
      id: it?.id,
      key: it?.key,
      title: it?.fields?.summary,
      status: it?.fields?.status?.name,
      type: it?.fields?.issuetype?.name,
    }));
  }

  /**
   * Rich JQL search that also returns description (ADF flattened), labels,
   * priority, assignee, and Story Points (resolved via getFieldMapping so it
   * works on Cloud + Team-managed + Classic projects).
   *
   * Used by the agent's semantic-search and complexity-analysis intents
   * ("user stories related to security", "which tasks are most complex").
   */
  async searchIssuesRich(
    jql: string,
    maxResults = 25,
  ): Promise<
    Array<{
      id?: string;
      key?: string;
      title?: string;
      status?: string;
      type?: string;
      priority?: string;
      labels?: string[];
      assignee?: string;
      description?: string;
      storyPoints?: number;
    }>
  > {
    // Resolve the project's Story Points custom-field id once per call.
    let storyPointsFieldId = "";
    try {
      const mapping = await this.getFieldMapping();
      storyPointsFieldId = mapping.storyPointsFieldId || "";
    } catch (err) {
      console.warn(
        `[JiraService.searchIssuesRich] Could not resolve field mapping: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const fields = [
      "summary",
      "status",
      "issuetype",
      "priority",
      "labels",
      "assignee",
      "description",
      ...(storyPointsFieldId ? [storyPointsFieldId] : []),
    ];

    const resp = await this.request<any>(`/search/jql`, {
      method: "POST",
      body: JSON.stringify({ jql, maxResults, fields }),
    });

    const issues: any[] = Array.isArray(resp?.issues) ? resp.issues : [];
    return issues.map((it) => {
      const f = it?.fields || {};
      const sp =
        storyPointsFieldId && f[storyPointsFieldId] != null
          ? Number(f[storyPointsFieldId])
          : undefined;
      return {
        id: it?.id,
        key: it?.key,
        title: f.summary,
        status: f.status?.name,
        type: f.issuetype?.name,
        priority: f.priority?.name,
        labels: Array.isArray(f.labels) ? f.labels : [],
        assignee: f.assignee?.displayName,
        description: flattenAdf(f.description),
        storyPoints: Number.isFinite(sp) ? sp : undefined,
      };
    });
  }

  /**
   * Fetch issue types configured for a specific Jira project.
   * This is used to cache available work item/issue types per SDLC project
   * so that downstream prompts and hierarchy rules can adapt dynamically.
   */
  async getIssueTypesForProject(projectKeyOrId: string): Promise<Array<{ id: string; name: string; hierarchyLevel?: number; subtask?: boolean }>> {
    let issueTypes: any[] = [];

    // Quick auth check: /myself should always work if credentials are valid
    try {
      const me = await this.request<any>(`/myself`);
      console.log(`[JiraService] Auth OK — connected as: ${me.displayName} (${me.accountId}), email: ${me.emailAddress || 'hidden'}`);
    } catch (authErr) {
      const authMessage = authErr instanceof Error ? authErr.message : String(authErr);
      console.error(`[JiraService] AUTH FAILED on /myself: ${authMessage}`);
      throw new Error(
        `Jira authentication failed for ${this.config.email} on ${this.config.instanceUrl}. ` +
        `Reconnect your personal Jira API token and confirm it can access project ${projectKeyOrId}. ` +
        `Details: ${authMessage}`
      );
    }

    // Strategy 1: createmeta endpoint (most reliable for what you can actually create)
    try {
      console.log(`[JiraService] Trying createmeta endpoint for ${projectKeyOrId}...`);
      const meta = await this.request<any>(
        `/issue/createmeta/${encodeURIComponent(projectKeyOrId)}/issuetypes`
      );
      issueTypes = meta.issueTypes || meta.values || (Array.isArray(meta) ? meta : []);
      console.log(`[JiraService] createmeta returned ${issueTypes.length} types`);
    } catch (e1) {
      console.warn(`[JiraService] createmeta failed: ${e1 instanceof Error ? e1.message : String(e1)}`);
    }

    // Strategy 2: project endpoint (returns issue types attached to project)
    if (issueTypes.length === 0) {
      try {
        console.log(`[JiraService] Trying /project/${projectKeyOrId} endpoint...`);
        const project = await this.request<any>(`/project/${encodeURIComponent(projectKeyOrId)}`);
        issueTypes = project.issueTypes || [];
        console.log(`[JiraService] /project returned ${issueTypes.length} types`);

        // If /project worked, also grab the project numeric ID for fallback 3
        if (issueTypes.length === 0 && project.id) {
          try {
            console.log(`[JiraService] Trying /issuetype/project?projectId=${project.id}...`);
            const typesById = await this.request<any[]>(`/issuetype/project?projectId=${project.id}`);
            issueTypes = Array.isArray(typesById) ? typesById : [];
            console.log(`[JiraService] /issuetype/project returned ${issueTypes.length} types`);
          } catch (e3) {
            console.warn(`[JiraService] /issuetype/project failed: ${e3 instanceof Error ? e3.message : String(e3)}`);
          }
        }
      } catch (e2) {
        console.warn(`[JiraService] /project failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
        // List all accessible projects to help diagnose wrong project key
        try {
          const allProjects = await this.request<any[]>(`/project/search?maxResults=20`);
          const projectList = (allProjects as any)?.values || (Array.isArray(allProjects) ? allProjects : []);
          console.log(`[JiraService] Accessible projects: ${projectList.map((p: any) => `${p.key}(${p.name})`).join(', ') || 'NONE'}`);
        } catch {
          try {
            const allProjects = await this.request<any[]>(`/project`);
            const projectArr = Array.isArray(allProjects) ? allProjects : [];
            console.log(`[JiraService] Accessible projects (legacy): ${projectArr.map((p: any) => `${p.key}(${p.name})`).join(', ') || 'NONE'}`);
          } catch (ep) {
            console.warn(`[JiraService] Could not list projects: ${ep instanceof Error ? ep.message : String(ep)}`);
          }
        }
      }
    }

    // Strategy 3: createmeta with expand (older Jira Cloud API)
    if (issueTypes.length === 0) {
      try {
        console.log(`[JiraService] Trying legacy createmeta with expand for ${projectKeyOrId}...`);
        const legacyMeta = await this.request<any>(
          `/issue/createmeta?projectKeys=${encodeURIComponent(projectKeyOrId)}&expand=projects.issuetypes`
        );
        const projects = legacyMeta.projects || [];
        if (projects.length > 0) {
          issueTypes = projects[0].issuetypes || [];
        }
        console.log(`[JiraService] Legacy createmeta returned ${issueTypes.length} types`);
      } catch (e4) {
        console.warn(`[JiraService] Legacy createmeta failed: ${e4 instanceof Error ? e4.message : String(e4)}`);
      }
    }

    // Strategy 4: global issue types (least specific but always works)
    if (issueTypes.length === 0) {
      try {
        console.log(`[JiraService] Trying global /issuetype endpoint...`);
        const allTypes = await this.request<any>(`/issuetype`);
        const rawArr = Array.isArray(allTypes) ? allTypes : [];
        console.log(`[JiraService] Global /issuetype raw response: ${rawArr.length} types, sample: ${JSON.stringify(rawArr.slice(0, 3).map((t: any) => ({ id: t.id, name: t.name, subtask: t.subtask, scope: t.scope?.type })))}`);
        // Include ALL types (don't filter subtasks) -- we need at least some types for ID resolution
        issueTypes = rawArr;
        console.log(`[JiraService] Global /issuetype returned ${issueTypes.length} types`);
      } catch (e5) {
        console.warn(`[JiraService] Global /issuetype failed: ${e5 instanceof Error ? e5.message : String(e5)}`);
      }
    }

    const result = issueTypes.map((t: any) => ({
      id: String(t.id),
      name: String(t.name),
      hierarchyLevel: typeof t.hierarchyLevel === "number" ? t.hierarchyLevel : undefined,
      subtask: !!t.subtask,
    }));

    console.log("[JiraService] Retrieved issue types for project:", {
      projectKeyOrId,
      count: result.length,
      types: result.map((t: any) => `${t.name}(id:${t.id})`),
    });

    return result;
  }

  async getCurrentUser(): Promise<{ accountId: string; displayName: string; emailAddress?: string } | null> {
    try {
      const user = await this.request<{ accountId: string; displayName: string; emailAddress?: string }>('/myself');
      console.log(`[JiraService] Current user: ${user.displayName} (${user.accountId})`);
      return user;
    } catch (error) {
      console.warn(`[JiraService] Could not fetch current user via /myself:`, error instanceof Error ? error.message : 'Unknown error');
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        throw error;
      }

      
      // Fallback 2: Search for user by email (most robust if we have the email)
      if (this.config.email) {
        try {
          console.log(`[JiraService] Falling back to user search by email: ${this.config.email}`);
          const users = await this.request<any[]>(`/user/search?query=${encodeURIComponent(this.config.email)}`);
          if (users && users.length > 0) {
            const user = users[0];
            console.log(`[JiraService] Found user via email search: ${user.displayName} (${user.accountId})`);
            return {
              accountId: user.accountId,
              displayName: user.displayName || 'Unknown',
              emailAddress: user.emailAddress || this.config.email,
            };
          }
        } catch (emailError) {
          console.warn(`[JiraService] Email search fallback also failed:`, emailError instanceof Error ? emailError.message : 'Unknown error');
        }
      }
      
      return null;
    }
  }

  /**
   * Probe whether the authenticating account has the global "Administer Jira"
   * permission, which is what `POST /rest/api/3/project` requires. Returns
   * `null` if the probe could not run (network error, endpoint unavailable),
   * which callers should treat as "unknown" rather than "denied".
   */
  async hasGlobalAdminPermission(): Promise<boolean | null> {
    try {
      const data = await this.request<{ permissions?: Record<string, { havePermission?: boolean }> }>(
        '/mypermissions?permissions=ADMINISTER',
      );
      const have = data?.permissions?.ADMINISTER?.havePermission;
      if (typeof have === 'boolean') return have;
      return null;
    } catch (error) {
      console.warn('[JiraService] /mypermissions probe failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Check if the authenticating account has a specific permission in a project.
   */
  async hasProjectPermission(projectKey: string, permission: string = 'CREATE_ISSUES'): Promise<boolean | null> {
    try {
      const data = await this.request<{ permissions?: Record<string, { havePermission?: boolean }> }>(
        `/mypermissions?projectKey=${encodeURIComponent(projectKey)}&permissions=${encodeURIComponent(permission)}`,
      );
      const have = data?.permissions?.[permission]?.havePermission;
      if (typeof have === 'boolean') return have;
      return null;
    } catch (error) {
      console.warn(`[JiraService] /mypermissions probe for ${permission} on ${projectKey} failed:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Add a user to a project role.
   */
  async addProjectActor(projectKey: string, accountId: string, roleNamesToTry: string[] = ['Developers', 'Users', 'Administrators', 'Member']): Promise<boolean> {
    try {
      // 1. Get project roles
      const rolesMap = await this.request<Record<string, string>>(`/project/${encodeURIComponent(projectKey)}/role`);
      
      let roleUrl = '';
      for (const name of roleNamesToTry) {
        if (rolesMap[name]) {
          roleUrl = rolesMap[name];
          break;
        }
      }
      
      if (!roleUrl) {
        // Fallback: pick the first available role if none matched
        const availableRoles = Object.values(rolesMap);
        if (availableRoles.length > 0) {
          roleUrl = availableRoles[0];
        } else {
          console.warn(`[JiraService] No roles found for project ${projectKey}`);
          return false;
        }
      }
      
      // 2. Add user to the role
      await this.request(roleUrl, {
        method: 'POST',
        body: JSON.stringify({ user: [accountId] })
      });
      
      console.log(`[JiraService] Added user ${accountId} to project ${projectKey} via role URL ${roleUrl}`);
      return true;
    } catch (error) {
      console.error(`[JiraService] Failed to add user ${accountId} to project ${projectKey}:`, error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * List users who can be assigned to issues in the given Jira project.
   * Uses Jira Cloud's `/user/assignable/search?project={key}` endpoint, which
   * is the correct endpoint for the assignee dropdown (only returns users
   * with the "Assignable User" permission for the project).
   *
   * @param projectKey  Jira project key (e.g. "ISTEST"). Required by Jira.
   * @param query       Optional substring to narrow results (Jira matches
   *                    against displayName and email).
   * @param maxResults  Defaults to 50 (Jira's hard cap is 1000).
   */
  async getAssignableUsers(
    projectKey: string,
    query: string = '',
    maxResults: number = 50,
  ): Promise<Array<{ accountId: string; displayName: string; emailAddress?: string; active: boolean }>> {
    if (!projectKey) {
      throw new Error('projectKey is required to list assignable Jira users');
    }
    const params = new URLSearchParams({
      project: projectKey,
      maxResults: String(maxResults),
    });
    // `query` is required on Jira Cloud (empty string returns recent users).
    params.append('query', query);

    try {
      const users = await this.request<any[]>(`/user/assignable/search?${params.toString()}`);
      const list = Array.isArray(users) ? users : [];
      return list
        .filter((u) => u && u.accountId)
        .map((u) => ({
          accountId: String(u.accountId),
          displayName: String(u.displayName || u.emailAddress || u.accountId),
          emailAddress: u.emailAddress,
          active: u.active !== false,
        }));
    } catch (error) {
      console.warn(
        `[JiraService] getAssignableUsers(${projectKey}) failed:`,
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  /**
   * Look up a Jira user by email and return their accountId.
   * Returns null if the user is not found in this Jira instance.
   */
  async findUserByEmail(email: string): Promise<{ accountId: string; displayName: string } | null> {
    try {
      const users = await this.request<any[]>(`/user/search?query=${encodeURIComponent(email)}`);
      if (users && users.length > 0) {
        const match = users.find((u: any) => u.emailAddress?.toLowerCase() === email.toLowerCase()) || users[0];
        console.log(`[JiraService] Found Jira user for ${email}: ${match.displayName} (${match.accountId})`);
        return { accountId: match.accountId, displayName: match.displayName };
      }
      console.log(`[JiraService] No Jira user found for email: ${email}`);
      return null;
    } catch (error) {
      console.warn(`[JiraService] User lookup failed for ${email}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  async deleteProject(projectKeyOrId: string): Promise<void> {
    await this.request(`/project/${encodeURIComponent(projectKeyOrId)}`, {
      method: 'DELETE',
    });
    console.log(`[JiraService] Successfully deleted project: ${projectKeyOrId}`);
  }

  async createProject(options: {
    name: string;
    key: string;
    projectTypeKey?: string;
    description?: string;
    leadAccountId?: string;
    projectTemplateKey?: string;
  }): Promise<ProjectInfo> {
    
    // 1. Get project lead - use provided leadAccountId or fetch current user's account ID
    let leadAccountId = options.leadAccountId;
    if (!leadAccountId) {
      const currentUser = await this.getCurrentUser();
      if (currentUser && currentUser.accountId) {
        leadAccountId = currentUser.accountId;
        console.log(`[JiraService] Using current user as project lead: ${currentUser.displayName} (${currentUser.accountId})`);
      } else {
        console.warn('[JiraService] Unable to determine project lead from current user.');
      }
    }

    // 2. Build ordered template list based on the requested project type.
    //    Each entry is [templateKey, projectTypeKey] — undefined templateKey means
    //    no template in the payload (Jira picks its own default).
    const requestedType = options.projectTypeKey || 'software';

    let templatesToTry: Array<[string | undefined, string]>;

    if (requestedType === 'service_desk') {
      templatesToTry = [
        // User-supplied override first
        ...(options.projectTemplateKey ? [[options.projectTemplateKey, 'service_desk'] as [string, string]] : []),
        ['com.atlassian.servicedesk:itil-v2-service-desk-project', 'service_desk'],
        ['com.atlassian.servicedesk:simplified-it-service-desk', 'service_desk'],
        ['com.atlassian.servicedesk:simplified-general-service-desk-it', 'service_desk'],
        [undefined, 'service_desk'], // Last resort — no template, explicit type
      ];
    } else if (requestedType === 'business') {
      templatesToTry = [
        ...(options.projectTemplateKey ? [[options.projectTemplateKey, 'business'] as [string, string]] : []),
        ['com.atlassian.jira-core-project-templates:jira-core-simplified-project-management', 'business'],
        [undefined, 'business'],
      ];
    } else {
      // software (Scrum, Kanban, or team-managed)
      templatesToTry = [
        ...(options.projectTemplateKey ? [[options.projectTemplateKey, 'software'] as [string, string]] : []),
        ['com.pyxis.greenhopper.jira:gh-simplified-agility-scrum', 'software'],
        ['com.pyxis.greenhopper.jira:gh-scrum-template', 'software'],
        ['com.pyxis.greenhopper.jira:gh-kanban-template', 'software'],
        [undefined, 'software'],
      ];
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    templatesToTry = templatesToTry.filter(([tmpl]) => {
      const k = tmpl ?? '__none__';
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    let lastError: any;

    for (const [template, typeKey] of templatesToTry) {
      const payload: any = {
        name: options.name,
        key: options.key.toUpperCase(),
        projectTypeKey: typeKey,
        assigneeType: 'PROJECT_LEAD',
      };

      if (options.description) {
        payload.description = options.description;
      }

      if (leadAccountId) {
        payload.leadAccountId = leadAccountId;
      }

      if (template) {
        payload.projectTemplateKey = template;
      }

      console.log(`[JiraService] Attempting to create project with template: ${template || 'NONE'} (Type: ${typeKey})`);

      try {
        const response = await this.request<JiraProject>('/project', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        
        console.log(`[JiraService] Successfully created project ${response.key} with template ${template || 'NONE'}`);
        return {
          id: response.id,
          key: response.key,
          name: options.name,
          description: response.description,
        };
      } catch (error: any) {
        lastError = error;
        // If it's a 400 Bad Request regarding templates, we continue loop
        const isTemplateError = error.message && (error.message.includes('template') || error.message.includes('400') || error.message.includes('projectTypeKey'));
        if (!isTemplateError) {
          throw error; // Fail fast on authentication or network errors
        }
        console.warn(`[JiraService] Template ${template || 'NONE'} rejected by Jira, trying next fallback...`);
      }
    }

    // If we exhausted all template possibilities, throw the last rejection error
    throw lastError;
  }

  async getFieldMapping(): Promise<JiraFieldMapping> {
    if (this.fieldMapping) return this.fieldMapping;

    const fields = await this.request<any[]>('/field');
    const fieldArr = Array.isArray(fields) ? fields : [];

    // Custom-field schema keys are locale-independent identifiers maintained
    // by Atlassian. Matching by these works even when the Jira account's
    // language is non-English (which renames Display names returned by
    // `/field`). They are also stable across Classic vs Team-managed projects.
    const ATLASSIAN_CUSTOM_KEYS = {
      storyPoints: [
        'com.atlassian.jira.plugin.system.customfieldtypes:float', // generic; filtered by name below
        'com.pyxis.greenhopper.jira:jsw-story-points',
        'com.pyxis.greenhopper.jira:gh-story-points',
      ],
      epicLink: [
        'com.pyxis.greenhopper.jira:gh-epic-link',
        'com.atlassian.jpo:jpo-custom-field-parent',
      ],
      sprint: [
        'com.pyxis.greenhopper.jira:gh-sprint',
      ],
      epicName: [
        'com.pyxis.greenhopper.jira:gh-epic-label',
      ],
    };

    this.fieldMapping = {
      instanceUrl: this.config.instanceUrl,
      storyPointsFieldId:
        this.findFieldId(fieldArr, ['Story Points', 'Story point estimate']) ||
        this.findFieldIdBySchema(fieldArr, ATLASSIAN_CUSTOM_KEYS.storyPoints, /story.?point/i),
      epicLinkFieldId:
        this.findFieldId(fieldArr, ['Epic Link', 'Parent Link']) ||
        this.findFieldIdBySchema(fieldArr, ATLASSIAN_CUSTOM_KEYS.epicLink),
      sprintFieldId:
        this.findFieldId(fieldArr, ['Sprint']) ||
        this.findFieldIdBySchema(fieldArr, ATLASSIAN_CUSTOM_KEYS.sprint),
      acceptanceCriteriaFieldId: this.findFieldId(fieldArr, [
        'Acceptance Criteria',
        'Acceptance criteria',
      ]),
      epicNameFieldId:
        this.findFieldId(fieldArr, ['Epic Name']) ||
        this.findFieldIdBySchema(fieldArr, ATLASSIAN_CUSTOM_KEYS.epicName),
      cachedAt: new Date(),
    };

    // Log field mapping results for debugging. Include total field count and
    // a few sample names so a localized or empty `/field` response is obvious
    // (a result of NOT_FOUND across the board with `totalFields=0` means the
    // token can't read /field; with a non-zero count + localized names, the
    // Accept-Language header should normally make this English now).
    const sampleNames = fieldArr.slice(0, 8).map((f: any) => f?.name).filter(Boolean);
    console.log(`[JiraService] Field mapping for ${this.config.projectKey}:`, {
      totalFields: fieldArr.length,
      sampleNames,
      storyPoints: this.fieldMapping.storyPointsFieldId || 'NOT_FOUND',
      epicLink: this.fieldMapping.epicLinkFieldId || 'NOT_FOUND',
      sprint: this.fieldMapping.sprintFieldId || 'NOT_FOUND',
      acceptanceCriteria: this.fieldMapping.acceptanceCriteriaFieldId || 'NOT_FOUND',
      epicName: this.fieldMapping.epicNameFieldId || 'NOT_FOUND',
    });

    // Note: NOT_FOUND for these custom fields is not necessarily an error.
    //  - Team-managed (next-gen) projects use the native `parent` relation
    //    instead of "Epic Link" and the `summary` field instead of "Epic Name",
    //    so those custom fields simply don't exist.
    //  - "Sprint" only exists when the project has agile/Scrum features.
    //  - Backlog reads still work without any of these — they only enable
    //    extra metadata (story points, epic linking, etc).
    if (
      fieldArr.length > 0 &&
      !this.fieldMapping.storyPointsFieldId &&
      !this.fieldMapping.epicLinkFieldId &&
      !this.fieldMapping.epicNameFieldId
    ) {
      console.warn(
        `[JiraService] No legacy "Epic Link"/"Epic Name"/"Story Points" custom fields found on project ${this.config.projectKey}. ` +
        `This is normal for Team-managed (next-gen) projects, which use the native \`parent\` and \`summary\` fields instead. ` +
        `Basic backlog reads will still work; only story-point sums and legacy epic links will be unavailable.`,
      );
    }

    return this.fieldMapping;
  }

  /**
   * Check if a custom field is available for a specific issue type
   */
  async isFieldAvailableForIssueType(fieldId: string, issueTypeName: string): Promise<boolean> {
    if (!fieldId || !fieldId.startsWith('customfield_')) {
      return true; // Standard fields are generally available
    }
    
    try {
      const meta = await this.request<any>(`/issue/createmeta/${encodeURIComponent(this.config.projectKey || '')}/issuetypes`);
      const issueType = meta.issueTypes?.find((type: any) => 
        type.name.toLowerCase() === issueTypeName.toLowerCase()
      );
      
      if (!issueType || !issueType.fields) {
        console.warn(`[JiraService] Issue type "${issueTypeName}" not found in create meta`);
        return false;
      }
      
      const fieldExists = !!issueType.fields[fieldId];
      console.log(`[JiraService] Field ${fieldId} ${fieldExists ? 'is available' : 'is NOT available'} for issue type "${issueTypeName}"`);
      return fieldExists;
    } catch (error) {
      console.warn(`[JiraService] Failed to check field availability: ${error instanceof Error ? error.message : error}`);
      return false; // Safe default - don't use questionable fields
    }
  }

  private findFieldId(fields: any[], names: string[]): string {
    for (const name of names) {
      const field = fields.find((f) => 
        f.name.toLowerCase() === name.toLowerCase() ||
        f.clauseNames?.some((cn: string) => cn.toLowerCase() === name.toLowerCase())
      );
      if (field) {
        console.log(`[JiraService] Found field "${name}" -> ${field.id} (name: "${field.name}")`);
        return field.id;
      }
    }
    console.log(`[JiraService] Field not found for any of: ${names.join(', ')}`);
    return '';
  }

  /**
   * Locale-independent custom-field lookup. Atlassian assigns each custom
   * field a stable `schema.custom` key (e.g. "com.pyxis.greenhopper.jira:gh-epic-link")
   * that does not change when the user's display language is non-English.
   * The optional `nameRegex` further constrains generic keys (e.g. the float
   * type is shared with many number fields, so we still filter by name).
   */
  private findFieldIdBySchema(fields: any[], schemaCustoms: string[], nameRegex?: RegExp): string {
    for (const schemaCustom of schemaCustoms) {
      const candidates = fields.filter(
        (f) => f?.schema?.custom === schemaCustom,
      );
      const match = nameRegex
        ? candidates.find((f) => typeof f?.name === 'string' && nameRegex.test(f.name))
        : candidates[0];
      if (match) {
        console.log(
          `[JiraService] Found field by schema "${schemaCustom}" -> ${match.id} (name: "${match.name}")`,
        );
        return match.id;
      }
    }
    return '';
  }

  private _hasEpicTypeCache: boolean | null = null;
  private _epicDetectionFailed: boolean = false;

  async hasEpicType(): Promise<boolean> {
    if (this._hasEpicTypeCache !== null) return this._hasEpicTypeCache;
    try {
      const types = await this.getIssueTypesForProject(this.config.projectKey || '');
      this._hasEpicTypeCache = types.some(t => t.name.toLowerCase() === 'epic');
      this._epicDetectionFailed = false;
      console.log(`[JiraService.hasEpicType] projectKey="${this.config.projectKey}" hasEpic=${this._hasEpicTypeCache} (from ${types.length} issue types: ${types.map(t => t.name).join(', ')})`);
      return this._hasEpicTypeCache;
    } catch (err) {
      // IMPORTANT: do not silently swallow. Detection failures often stem from
      // permission issues or invalid project keys and were previously causing
      // the no-Epic JQL branch to run on standard Scrum/Classic projects,
      // which drops Story / User Story rows and yields "0 work items".
      this._epicDetectionFailed = true;
      console.warn(
        `[JiraService.hasEpicType] Detection failed for projectKey="${this.config.projectKey}" — assuming Epic type exists to keep Story/User Story in fallback JQL. Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Treat unknown as `true` so the broader Scrum/Classic JQL is used.
      // The narrow Task-only branch only runs on a confirmed no-Epic project.
      this._hasEpicTypeCache = true;
      return true;
    }
  }

  /**
   * Run a JQL query and return mapped WorkItems, performing a per-issue
   * detail fetch when the new `/search/jql` endpoint returns minimal
   * payloads (i.e. issues without their `fields`). Used by `getEpics()`
   * for its multi-step fallback chain.
   */
  private async fetchAndMapIssues(
    jql: string,
    label: string,
    maxResults = 500,
  ): Promise<WorkItem[]> {
    const response = await this.request<{ issues: JiraIssue[] }>(
      `/search/jql`,
      {
        method: 'POST',
        body: JSON.stringify({
          jql,
          maxResults,
          fields: ['*all'],
        }),
      },
    );

    const issuesRaw = response.issues || (response as any) || [];
    if (!Array.isArray(issuesRaw)) {
      console.warn(`[JiraService.${label}] Unexpected response format:`, response);
      return [];
    }

    let issues = issuesRaw;
    if (issuesRaw.length > 0 && !issuesRaw[0]?.fields) {
      console.log(
        `[JiraService.${label}] Issues missing fields, fetching full details for`,
        issuesRaw.length,
        'issues...',
      );
      const batchSize = 10;
      const batches: Promise<(JiraIssue | null)[]>[] = [];
      for (let i = 0; i < issuesRaw.length; i += batchSize) {
        const batch = issuesRaw.slice(i, i + batchSize);
        batches.push(
          Promise.all(
            batch.map((issue: any) => {
              const issueId = issue.id || issue.key;
              if (!issueId) return null;
              return this.request<JiraIssue>(`/issue/${issueId}`).catch((err) => {
                console.warn(
                  `[JiraService.${label}] Failed to fetch ${issueId}:`,
                  err?.message,
                );
                return null;
              });
            }),
          ),
        );
      }
      const results = await Promise.all(batches);
      issues = results
        .flat()
        .filter((issue): issue is JiraIssue => Boolean(issue && (issue as any).fields));
    }

    const fieldMapping = await this.getFieldMapping();
    return issues
      .filter((issue) => issue && issue.fields)
      .map((issue) => mapJiraIssueToWorkItem(issue, fieldMapping));
  }

  /**
   * @deprecated Use getStrategy().getBacklogTreeForEpic() for tree-structured reads.
   * Kept as a backward-compatible shim for existing call sites.
   *
   * Returns "high-level" backlog items for the configured project. We try
   * progressively broader JQL until something matches so that test/sandbox
   * projects that have issues but no Epics still surface useful items:
   *   1. Epic issuetype (when the project has the Epic type)
   *   2. Top-level Tasks (parent IS EMPTY) — current legacy fallback
   *   3. Any issue without a parent (regardless of issuetype)
   *   4. Any issue in the project, ordered by created DESC
   * The first non-empty step wins.
   */
  async getEpics(search?: string): Promise<WorkItem[]> {
    const hasEpic = await this.hasEpicType();
    const projectKey = this.config.projectKey;

    // Optional server-side text filter on summary (matches the design-prompt
    // epic search box). Strip quotes/backslashes to avoid breaking the JQL.
    const sanitizedSearch = (search || '').trim().replace(/["\\]/g, '');
    const textClause = sanitizedSearch ? ` AND summary ~ "${sanitizedSearch}*"` : '';

    const candidates: Array<{ jql: string; label: string }> = hasEpic
      ? [
          {
            label: 'Epics',
            jql: `project = "${projectKey}" AND issuetype = Epic${textClause} ORDER BY created DESC`,
          },
        ]
      : [
          {
            label: 'top-level Tasks',
            jql: `project = "${projectKey}" AND issuetype = Task AND parent is EMPTY${textClause} ORDER BY created DESC`,
          },
          {
            label: 'top-level items (any type)',
            jql: `project = "${projectKey}" AND parent is EMPTY${textClause} ORDER BY created DESC`,
          },
          {
            label: 'recent issues (any type)',
            jql: `project = "${projectKey}"${textClause} ORDER BY created DESC`,
          },
        ];

    for (const { jql, label } of candidates) {
      console.log(`[JiraService.getEpics] Trying "${label}" — JQL: ${jql}`);
      const items = await this.fetchAndMapIssues(jql, 'getEpics');
      console.log(`[JiraService.getEpics] "${label}" returned ${items.length} items`);
      if (items.length > 0) {
        return items;
      }
    }

    console.log(
      `[JiraService.getEpics] Project ${projectKey} returned 0 items across all fallbacks`,
    );
    return [];
  }

  /**
   * @deprecated Use getStrategy().getBacklogTreeForEpic() for tree-structured reads.
   * Kept as a backward-compatible shim for existing call sites.
   */
  async getFeatures(): Promise<WorkItem[]> {
    const jql = `project = "${this.config.projectKey}" AND issuetype IN (Feature, Task) AND issuetype NOT IN (Sub-task, Subtask) ORDER BY created DESC`;
    const response = await this.request<{ issues: JiraIssue[] }>(
      `/search/jql`,
      {
        method: 'POST',
        body: JSON.stringify({
          jql,
          maxResults: 500,
          fields: ['*all'],
        }),
      }
    );
    
    // Handle response structure - new API might return different format
    const issuesRaw = response.issues || response as any || [];
    if (!Array.isArray(issuesRaw)) {
      console.warn('[JiraService] Unexpected response format for features:', response);
      return [];
    }

    // If issues don't have fields, fetch them individually
    let issues = issuesRaw;
    if (issuesRaw.length > 0 && !issuesRaw[0]?.fields) {
      console.log('[JiraService.getFeatures] Issues missing fields, fetching full details for', issuesRaw.length, 'issues...');
      // Fetch in batches of 10 - fetch ALL issues, not just first 100
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < issuesRaw.length; i += batchSize) {
        const batch = issuesRaw.slice(i, i + batchSize);
        batches.push(
          Promise.all(
            batch.map((issue: any) => {
              const issueId = issue.id || issue.key;
              if (!issueId) return null;
              return this.request<JiraIssue>(`/issue/${issueId}`).catch((err) => {
                console.warn(`[JiraService.getFeatures] Failed to fetch ${issueId}:`, err?.message);
                return null;
              });
            })
          )
        );
      }
      const results = await Promise.all(batches);
      issues = results
        .flat()
        .filter((issue): issue is JiraIssue => Boolean(issue && (issue as any).fields));
    }

    const fieldMapping = await this.getFieldMapping();
    return issues
      .filter((issue) => issue && issue.fields) // Filter out invalid issues
      .map((issue) => ({
      ...mapJiraIssueToWorkItem(issue, fieldMapping),
      type: 'feature' as const,
    }));
  }

  /**
   * @deprecated Use getStrategy().getBacklogTreeForEpic() for tree-structured reads.
   * Kept as a backward-compatible shim for existing call sites.
   */
  async getUserStories(search?: string): Promise<WorkItem[]> {
    const sanitizedSearch = (search || '').trim().replace(/["\\]/g, '');
    const textClause = sanitizedSearch ? ` AND summary ~ "${sanitizedSearch}*"` : '';
    const jql = `project = "${this.config.projectKey}" AND issuetype IN (Story, "User Story")${textClause} ORDER BY created DESC`;
    const response = await this.request<{ issues: JiraIssue[] }>(
      `/search/jql`,
      {
        method: 'POST',
        body: JSON.stringify({
          jql,
          maxResults: 500,
          fields: ['*all'],
        }),
      }
    );
    
    // Handle response structure - new API might return different format
    const issuesRaw = response.issues || response as any || [];
    if (!Array.isArray(issuesRaw)) {
      console.warn('[JiraService] Unexpected response format for user stories:', response);
      return [];
    }

    // If issues don't have fields, fetch them individually
    let issues = issuesRaw;
    if (issuesRaw.length > 0 && !issuesRaw[0]?.fields) {
      console.log('[JiraService.getUserStories] Issues missing fields, fetching full details for', issuesRaw.length, 'issues...');
      // Fetch in batches of 10 - fetch ALL issues, not just first 100
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < issuesRaw.length; i += batchSize) {
        const batch = issuesRaw.slice(i, i + batchSize);
        batches.push(
          Promise.all(
            batch.map((issue: any) => {
              const issueId = issue.id || issue.key;
              if (!issueId) return null;
              return this.request<JiraIssue>(`/issue/${issueId}`).catch((err) => {
                console.warn(`[JiraService.getUserStories] Failed to fetch ${issueId}:`, err?.message);
                return null;
              });
            })
          )
        );
      }
      const results = await Promise.all(batches);
      issues = results
        .flat()
        .filter((issue): issue is JiraIssue => Boolean(issue && (issue as any).fields));
    }

    const fieldMapping = await this.getFieldMapping();
    return issues
      .filter((issue) => issue && issue.fields) // Filter out invalid issues
      .map((issue) => mapJiraIssueToWorkItem(issue, fieldMapping));
  }

  async getWorkItem(id: string): Promise<WorkItem | null> {
    try {
      const issue = await this.request<JiraIssue>(`/issue/${id}`);
      const fieldMapping = await this.getFieldMapping();
      return mapJiraIssueToWorkItem(issue, fieldMapping);
    } catch {
      return null;
    }
  }

  async createWorkItem(item: Partial<WorkItem>): Promise<WorkItem> {
    if (!this.config.projectKey) {
      throw new Error("Project key is required to create a Jira work item");
    }
    const fieldMapping = await this.getFieldMapping();
    const jiraIssue = mapWorkItemToJiraIssue(item, this.config.projectKey, fieldMapping);
    
    const created = await this.request<JiraIssue>('/issue', {
      method: 'POST',
      body: JSON.stringify(jiraIssue),
    });
    
    const fullIssue = await this.request<JiraIssue>(`/issue/${created.id}`);
    return mapJiraIssueToWorkItem(fullIssue, fieldMapping);
  }

  async updateWorkItem(id: string, updates: Partial<WorkItem> & { assignee?: string | null }): Promise<WorkItem> {
    const fieldMapping = await this.getFieldMapping();
    const jiraUpdates: any = { fields: {} };

    if (updates.title) {
      jiraUpdates.fields.summary = updates.title;
    }
    if (updates.description) {
      jiraUpdates.fields.description = {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: updates.description }] }],
      };
    }
    if (updates.priority) {
      jiraUpdates.fields.priority = { name: updates.priority };
    }
    if (updates.storyPoints && fieldMapping.storyPointsFieldId) {
      jiraUpdates.fields[fieldMapping.storyPointsFieldId] = updates.storyPoints;
    }

    // Assignee: accountId for set, explicit null to clear.
    // Callers should resolve email/displayName to accountId before calling
    // updateWorkItem (see getAssignableUsers / findUserByEmail).
    if (Object.prototype.hasOwnProperty.call(updates, 'assignee')) {
      const a = (updates as any).assignee;
      if (a === null || a === '' || a === 'unassigned') {
        jiraUpdates.fields.assignee = null;
      } else if (typeof a === 'string') {
        jiraUpdates.fields.assignee = { accountId: a };
      }
    }

    await this.request(`/issue/${id}`, {
      method: 'PUT',
      body: JSON.stringify(jiraUpdates),
    });

    const updated = await this.request<JiraIssue>(`/issue/${id}`);
    return mapJiraIssueToWorkItem(updated, fieldMapping);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await this.request(`/issue/${id}`, { method: 'DELETE' });
  }

  /**
   * Add a comment to a Jira issue using ADF format.
   */
  async addComment(issueIdOrKey: string, commentText: string): Promise<void> {
    const adfBody = {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: commentText }],
          },
        ],
      },
    };
    await this.request(`/issue/${issueIdOrKey}/comment`, {
      method: 'POST',
      body: JSON.stringify(adfBody),
    });
  }

  /**
   * Attach a file to a Jira issue.
   *
   * Used as an overflow channel for content that would exceed Jira Cloud's
   * description / comment body limit (~32,767 chars, surfaces as the
   * `CONTENT_LIMIT_EXCEEDED` error). The full content is uploaded as a file
   * attachment instead of being inlined in the description.
   *
   * Notes on the Jira REST contract:
   * - Endpoint: `POST /rest/api/3/issue/{idOrKey}/attachments`
   * - MUST send `X-Atlassian-Token: no-check` (Jira's CSRF bypass for upload)
   * - MUST NOT set `Content-Type: application/json` — `fetch` derives the
   *   correct multipart boundary from `FormData`. We deliberately bypass
   *   the shared `request()` helper because it injects JSON headers.
   */
  async addAttachment(
    issueIdOrKey: string,
    fileName: string,
    content: string | Buffer,
    mimeType: string = 'text/markdown',
  ): Promise<void> {
    if (!this.config.email || !this.config.apiToken) {
      throw new Error('Jira configuration is incomplete: email and API token are required');
    }

    const cleanInstanceUrl = this.config.instanceUrl.replace(/\/$/, '');
    const url = `${cleanInstanceUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/attachments`;
    const authToken = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64');

    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    // Node's Buffer isn't typed as a BlobPart in TS; use Uint8Array view.
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    const form = new FormData();
    form.append('file', blob, fileName);

    console.log(
      `[JiraService] POST ${url} (attachment: ${fileName}, ${buffer.length} bytes)`,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authToken}`,
        // CRITICAL: Jira blocks attachment uploads from clients without this
        // header to mitigate XSRF. Do NOT set Content-Type — let fetch derive
        // the multipart boundary automatically.
        'X-Atlassian-Token': 'no-check',
        Accept: 'application/json',
      },
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `Jira attachment upload failed: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.errorMessages && errorJson.errorMessages.length > 0) {
          errorMessage += ` - ${errorJson.errorMessages.join(', ')}`;
        } else if (errorJson.message) {
          errorMessage += ` - ${errorJson.message}`;
        } else {
          errorMessage += ` - ${errorBody}`;
        }
      } catch {
        errorMessage += ` - ${errorBody}`;
      }
      console.error(`[JiraService] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    console.log(
      `[JiraService] Attachment uploaded successfully to issue ${issueIdOrKey}: ${fileName}`,
    );
  }

  async getBacklogContext(maxResults: number = 500): Promise<BacklogContext> {
    if (!this.config.projectKey) {
      throw new Error('Project key is required for backlog context');
    }

    console.log('[JiraService.getBacklogContext] Starting with projectKey:', this.config.projectKey, 'maxResults:', maxResults);
    console.log('[JiraService.getBacklogContext] Instance URL:', this.config.instanceUrl);

    // Fetch epics, features (stories), and user stories separately
    let epicsResponse: any;
    let featuresResponse: any;
    let storiesResponse: any;

    try {
      const hasEpic = await this.hasEpicType();
      console.log('[JiraService.getBacklogContext] hasEpicType:', hasEpic);

      let epicJql: string;
      let featureJql: string;
      let storyJql: string;

      if (hasEpic) {
        epicJql = `project = "${this.config.projectKey}" AND issuetype = Epic ORDER BY created DESC`;
        featureJql = `project = "${this.config.projectKey}" AND issuetype IN (Feature, Task) AND issuetype NOT IN (Sub-task, Subtask) ORDER BY created DESC`;
        storyJql = `project = "${this.config.projectKey}" AND issuetype IN (Story, "User Story") ORDER BY created DESC`;
      } else {
        // No Epic type — treat top-level Tasks as "epics" and include the
        // common story/user-story names as well so we don't drop them on
        // projects that happen to use both Tasks and Stories without Epics.
        epicJql = `project = "${this.config.projectKey}" AND issuetype = Task AND parent is EMPTY ORDER BY created DESC`;
        featureJql = ``; // No separate features in Task/Sub-task projects
        storyJql = `project = "${this.config.projectKey}" AND issuetype IN (Story, "User Story") ORDER BY created DESC`;
      }

      console.log('[JiraService.getBacklogContext] Epic JQL:', epicJql);
      console.log('[JiraService.getBacklogContext] Feature JQL:', featureJql);
      console.log('[JiraService.getBacklogContext] Story JQL:', storyJql);

      // Try /search/jql endpoint (new Jira Cloud API)
      // Note: /search/jql might return minimal data (just IDs) by default
      // We'll fetch full issue details if fields are missing
      const makeSearchRequest = async (jql: string, endpoint: string = '/search/jql'): Promise<any> => {
        try {
          const requestBody: any = {
            jql: jql,
            maxResults,
          };

          // Try to request fields - but /search/jql might ignore this and return minimal data
          // We'll handle fetching full details if needed
          requestBody.fields = ['*all'];

          return await this.request<{ issues: JiraIssue[] }>(
            endpoint,
            {
              method: 'POST',
              body: JSON.stringify(requestBody),
            }
          );
        } catch (error: any) {
          // /search endpoint is deprecated (410 Gone), so we only use /search/jql
          // If /search/jql fails, throw the error directly
          throw error;
        }
      };

      [epicsResponse, featuresResponse, storiesResponse] = await Promise.all([
        makeSearchRequest(epicJql),
        featureJql ? makeSearchRequest(featureJql) : Promise.resolve({ issues: [] }),
        makeSearchRequest(storyJql),
      ]);

      console.log('[JiraService.getBacklogContext] Epics response:', {
        hasIssues: !!epicsResponse?.issues,
        issueCount: epicsResponse?.issues?.length || 0,
        responseKeys: Object.keys(epicsResponse || {}),
        fullResponse: JSON.stringify(epicsResponse, null, 2).substring(0, 500),
      });
      console.log('[JiraService.getBacklogContext] Features response:', {
        hasIssues: !!featuresResponse?.issues,
        issueCount: featuresResponse?.issues?.length || 0,
        responseKeys: Object.keys(featuresResponse || {}),
        fullResponse: JSON.stringify(featuresResponse, null, 2).substring(0, 500),
      });
      console.log('[JiraService.getBacklogContext] Stories response:', {
        hasIssues: !!storiesResponse?.issues,
        issueCount: storiesResponse?.issues?.length || 0,
        responseKeys: Object.keys(storiesResponse || {}),
        fullResponse: JSON.stringify(storiesResponse, null, 2).substring(0, 500),
      });

      // Check if response structure is different (some Jira instances might return different structure)
      if (!epicsResponse?.issues && epicsResponse) {
        console.warn('[JiraService.getBacklogContext] Epics response structure unexpected:', Object.keys(epicsResponse));
      }
      if (!featuresResponse?.issues && featuresResponse) {
        console.warn('[JiraService.getBacklogContext] Features response structure unexpected:', Object.keys(featuresResponse));
      }
      if (!storiesResponse?.issues && storiesResponse) {
        console.warn('[JiraService.getBacklogContext] Stories response structure unexpected:', Object.keys(storiesResponse));
      }
    } catch (error: any) {
      console.error('[JiraService.getBacklogContext] Error fetching issues:', error);
      console.error('[JiraService.getBacklogContext] Error details:', {
        message: error?.message,
        stack: error?.stack,
        response: error?.response,
      });
      throw new Error(`Failed to fetch Jira issues: ${error?.message || 'Unknown error'}`);
    }

    // Handle response structure - filter out invalid issues
    // Jira API might return issues in different formats:
    // - { issues: [...] } - standard format
    // - { values: [...] } - some endpoints use this
    // - Direct array - some responses
    const getIssuesFromResponse = (response: any): any[] => {
      if (!response) return [];
      if (Array.isArray(response)) return response;
      if (response.issues && Array.isArray(response.issues)) return response.issues;
      if (response.values && Array.isArray(response.values)) return response.values;
      if (response.results && Array.isArray(response.results)) return response.results;
      return [];
    };

    let epicsRaw = getIssuesFromResponse(epicsResponse);
    const featuresRaw = getIssuesFromResponse(featuresResponse);
    const storiesRaw = getIssuesFromResponse(storiesResponse);

    if (epicsRaw.length === 0) {
      try {
        const fallbackEpicJql = `project = "${this.config.projectKey}" AND (issuetype = Epic OR (issuetype = Task AND parent is EMPTY) OR labels = "devx-tier-epic") ORDER BY created DESC`;
        const fallbackResponse = await this.request<{ issues: JiraIssue[] }>(
          `/search/jql`,
          {
            method: 'POST',
            body: JSON.stringify({
              jql: fallbackEpicJql,
              maxResults: 500,
              fields: ['*all'],
            }),
          },
        );
        epicsRaw = getIssuesFromResponse(fallbackResponse);
        console.log('[JiraService.getBacklogContext] Epic fallback query used:', {
          fallbackEpicJql,
          epicCount: epicsRaw.length,
        });
      } catch (error) {
        console.warn('[JiraService.getBacklogContext] Epic fallback query failed:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log('[JiraService.getBacklogContext] Raw issue counts:', {
      epics: epicsRaw.length,
      features: featuresRaw.length,
      stories: storiesRaw.length,
    });

    // Check if issues have fields - if not, we need to fetch them
    const sampleEpic = epicsRaw[0];
    const sampleFeature = featuresRaw[0];
    const sampleStory = storiesRaw[0];

    console.log('[JiraService.getBacklogContext] Sample epic structure:', {
      hasId: !!sampleEpic?.id,
      hasKey: !!sampleEpic?.key,
      hasFields: !!sampleEpic?.fields,
      keys: sampleEpic ? Object.keys(sampleEpic) : [],
    });

    // If issues don't have fields, we need to fetch full issue details
    // The /search/jql endpoint might return minimal data by default
    let epics = epicsRaw;
    let features = featuresRaw;
    let stories = storiesRaw;

    // If issues don't have fields, fetch them individually
    // Batch fetch to avoid too many concurrent requests
    const fetchIssueDetails = async (issues: any[], type: string): Promise<any[]> => {
      if (issues.length === 0) return [];
      if (issues[0]?.fields) return issues; // Already have fields
      
      console.log(`[JiraService.getBacklogContext] ${type} missing fields, fetching full details for ${issues.length} issues...`);
      
      // Fetch in batches of 10 to avoid overwhelming the API - fetch ALL issues
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < issues.length; i += batchSize) {
        const batch = issues.slice(i, i + batchSize);
        batches.push(
          Promise.all(
            batch.map((issue: any) => {
              const issueId = issue.id || issue.key;
              if (!issueId) return null;
              return this.request<JiraIssue>(`/issue/${issueId}`).catch((err) => {
                console.warn(`[JiraService.getBacklogContext] Failed to fetch ${type} ${issueId}:`, err?.message);
                return null;
              });
            })
          )
        );
      }
      
      const results = await Promise.all(batches);
      return results.flat().filter((issue: any) => issue && issue.fields);
    };

    if (epicsRaw.length > 0 && !epicsRaw[0]?.fields) {
      epics = await fetchIssueDetails(epicsRaw, 'Epics');
    }

    if (featuresRaw.length > 0 && !featuresRaw[0]?.fields) {
      features = await fetchIssueDetails(featuresRaw, 'Features');
    }

    if (storiesRaw.length > 0 && !storiesRaw[0]?.fields) {
      stories = await fetchIssueDetails(storiesRaw, 'Stories');
    }

    // Final filter to ensure all have fields
    epics = epics.filter((issue: any) => issue && issue.fields);
    features = features.filter((issue: any) => issue && issue.fields);
    stories = stories.filter((issue: any) => issue && issue.fields);

    // Deduplicate: remove items in stories that are already counted as epics
    if (epics.length > 0) {
      const epicIds = new Set(epics.map((e: any) => e.id));
      stories = stories.filter((s: any) => !epicIds.has(s.id));
    }

    console.log('[JiraService.getBacklogContext] Final filtered counts:', {
      epics: epics.length,
      features: features.length,
      stories: stories.length,
    });

    // Get all unique statuses
    const allStatuses = new Set<string>();
    [...epics, ...features, ...stories].forEach(issue => {
      if (issue && issue.fields?.status?.name) {
        allStatuses.add(issue.fields.status.name);
      }
    });

    // Map Jira statuses to ADO-like states (common mappings)
    const statusMapping: Record<string, string> = {
      'To Do': 'New',
      'In Progress': 'Active',
      'Done': 'Closed',
      'In Review': 'Resolved',
      'Blocked': 'Active',
    };

    const normalizeStatus = (status: string): string => {
      return statusMapping[status] || status;
    };

    // Group by normalized state
    const stateCounts: Record<string, { epics: number; features: number; userStories: number; total: number }> = {};
    const developerMap: Record<string, { totalStories: number; storiesByState: Record<string, number>; totalStoryPoints: number; completedStoryPoints: number; stories: any[] }> = {};

    // Process epics
    epics.forEach(issue => {
      // Skip if issue or fields is undefined
      if (!issue || !issue.fields) {
        console.warn('[JiraService] Skipping epic with missing fields:', issue?.id);
        return;
      }

      const status = normalizeStatus(issue.fields?.status?.name || 'Unknown');
      if (!stateCounts[status]) {
        stateCounts[status] = { epics: 0, features: 0, userStories: 0, total: 0 };
      }
      stateCounts[status].epics++;
      stateCounts[status].total++;
    });

    // Process features (stories that are features)
    features.forEach(issue => {
      // Skip if issue or fields is undefined
      if (!issue || !issue.fields) {
        console.warn('[JiraService] Skipping feature with missing fields:', issue?.id);
        return;
      }

      const status = normalizeStatus(issue.fields?.status?.name || 'Unknown');
      if (!stateCounts[status]) {
        stateCounts[status] = { epics: 0, features: 0, userStories: 0, total: 0 };
      }
      stateCounts[status].features++;
      stateCounts[status].total++;
    });

    // Process user stories
    const fieldMapping = await this.getFieldMapping();
    stories.forEach(issue => {
      // Skip if issue or fields is undefined
      if (!issue || !issue.fields) {
        console.warn('[JiraService] Skipping issue with missing fields:', issue?.id);
        return;
      }

      const status = normalizeStatus(issue.fields?.status?.name || 'Unknown');
      if (!stateCounts[status]) {
        stateCounts[status] = { epics: 0, features: 0, userStories: 0, total: 0 };
      }
      stateCounts[status].userStories++;
      stateCounts[status].total++;

      // Track developer assignments
      const assignee = issue.fields?.assignee?.displayName || issue.fields?.assignee?.name || 'Unassigned';
      if (!developerMap[assignee]) {
        developerMap[assignee] = {
          totalStories: 0,
          storiesByState: {},
          totalStoryPoints: 0,
          completedStoryPoints: 0,
          stories: [],
        };
      }
      developerMap[assignee].totalStories++;
      developerMap[assignee].storiesByState[status] = (developerMap[assignee].storiesByState[status] || 0) + 1;

      // Safely access story points field
      const storyPoints = fieldMapping.storyPointsFieldId && issue.fields
        ? (issue.fields as any)[fieldMapping.storyPointsFieldId] || 0
        : 0;
      developerMap[assignee].totalStoryPoints += storyPoints;
      if (status === 'Closed' || status === 'Done') {
        developerMap[assignee].completedStoryPoints += storyPoints;
      }

      developerMap[assignee].stories.push({
        id: issue.id,
        title: issue.fields?.summary || 'Untitled',
        state: status,
        storyPoints: storyPoints,
      });
    });

    // Calculate velocity (completed story points in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let completedStoryPoints = 0;
    stories.forEach(issue => {
      // Skip if issue or fields is undefined
      if (!issue || !issue.fields) {
        return;
      }

      const status = normalizeStatus(issue.fields?.status?.name || 'Unknown');
      if (status === 'Closed' || status === 'Done') {
        const updatedDate = issue.fields?.updated ? new Date(issue.fields.updated) : null;
        if (updatedDate && updatedDate >= thirtyDaysAgo) {
          // Safely access story points field
          const storyPoints = fieldMapping.storyPointsFieldId && issue.fields
            ? (issue.fields as any)[fieldMapping.storyPointsFieldId] || 0
            : 0;
          completedStoryPoints += storyPoints;
        }
      }
    });

    const developerAssignments = Object.entries(developerMap).map(([displayName, data]) => ({
      displayName,
      totalStories: data.totalStories,
      storiesByState: data.storiesByState,
      totalStoryPoints: data.totalStoryPoints,
      completedStoryPoints: data.completedStoryPoints,
      stories: data.stories,
    }));

    const totalStoryPoints = Object.values(developerMap).reduce((sum, data) => sum + data.totalStoryPoints, 0);
    const totalCompletedStoryPoints = Object.values(developerMap).reduce((sum, data) => sum + data.completedStoryPoints, 0);

    // BacklogContext is intentionally a minimal shared type; this service returns
    // additional diagnostics used by DevX screens/agents. Cast to keep backwards
    // compatible signature while preserving runtime fields.
    return {
      stateCounts,
      developerAssignments,
      velocity: {
        last7Days: 0, // Can be calculated from stories updated in last 7 days
        last30Days: completedStoryPoints,
        totalStoryPoints,
        completedStoryPoints: totalCompletedStoryPoints,
        completionRate: totalStoryPoints > 0 ? (totalCompletedStoryPoints / totalStoryPoints) * 100 : 0,
      },
      // Provide mapped items for hierarchy and dashboard consumption
      epics: epics.map((e) => mapJiraIssueToWorkItem(e, fieldMapping)),
      features: features.map((f) => mapJiraIssueToWorkItem(f, fieldMapping)),
      userStories: stories.map((s) => mapJiraIssueToWorkItem(s, fieldMapping)),

      // Keep raw issues for reuse in other methods
      _rawEpics: epics,
      _rawFeatures: features,
      _rawStories: stories,
    } as any;
  }

  async getSprints(): Promise<SprintInfo[]> {
    try {
      const boards = await this.agileRequest<{ values: any[] }>(
        `/board?projectKeyOrId=${this.config.projectKey}`
      );
      
      if (!boards.values?.length) return [];
      
      const boardId = boards.values[0].id;
      const sprints = await this.agileRequest<{ values: JiraSprint[] }>(
        `/board/${boardId}/sprint`
      );

      return (sprints.values || []).map((sprint) => ({
        id: String(sprint.id),
        name: sprint.name,
        startDate: sprint.startDate ? new Date(sprint.startDate) : undefined,
        endDate: sprint.endDate ? new Date(sprint.endDate) : undefined,
        state: sprint.state,
      }));
    } catch {
      return [];
    }
  }

  async getSprintWorkItems(sprintId: string): Promise<WorkItem[]> {
    try {
      const issues = await this.agileRequest<{ issues: JiraIssue[] }>(
        `/sprint/${sprintId}/issue`
      );
      const fieldMapping = await this.getFieldMapping();
      return (issues.issues || []).map((issue) => 
        mapJiraIssueToWorkItem(issue, fieldMapping)
      );
    } catch {
      return [];
    }
  }

  async getRepositories(): Promise<RepositoryInfo[]> {
    return [];
  }

  async getBuilds(): Promise<BuildInfo[]> {
    return [];
  }

  async getPipelines(): Promise<any[]> {
    return [];
  }

  async getReleases(): Promise<ReleaseInfo[]> {
    try {
      const versions = await this.request<JiraVersion[]>(
        `/project/${this.config.projectKey}/versions`
      );
      
      return versions.map((version) => ({
        id: version.id,
        name: version.name,
        status: version.released ? 'released' : 'unreleased',
        createdAt: version.releaseDate ? new Date(version.releaseDate) : undefined,
      }));
    } catch {
      return [];
    }
  }

  async getReleaseDefinitions(): Promise<any[]> {
    return [];
  }

  async createRelease(definitionId: string, data: any): Promise<any> {
    const version = await this.request<JiraVersion>(
      `/project/${this.config.projectKey}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          projectId: parseInt(definitionId),
          released: false,
        }),
      }
    );
    return version;
  }

  async getTestRuns(): Promise<TestRun[]> {
    return [];
  }

  async getTestResults(testRunId: string): Promise<any[]> {
    return [];
  }

  async getMonitoringData(): Promise<any> {
    return {};
  }

  // ── Hierarchy capability detection ──

  async getHierarchyCapability(projectKey: string): Promise<HierarchyCapability> {
    if (this._hierarchyCapCache.has(projectKey)) return this._hierarchyCapCache.get(projectKey)!;

    const types = await this.getIssueTypesForProject(projectKey);
    if (!types || types.length === 0) {
      throw new Error(`[JiraHierarchy] No issue types returned for project ${projectKey}. Check authentication and project permissions.`);
    }

    const epicType = resolveIssueType('Epic', types);
    const featureType = resolveIssueType('Feature', types);
    const storyType = resolveIssueType('Story', types);
    const taskType = resolveIssueType('Task', types);
    const testCaseType = resolveIssueType('Test Case', types);
    
    // Sub-task is a special case: preferably a strict sub-task
    let subtaskTypeRaw = types.find(t => t.subtask || t.name.toLowerCase().includes('sub'));
    const subtaskType = subtaskTypeRaw ? { id: subtaskTypeRaw.id, name: subtaskTypeRaw.name } : resolveIssueType('Sub-task', types);
    
    const bugType = resolveIssueType('Bug', types);

    const issueTypeIdMap: HierarchyCapability['issueTypeIdMap'] = {
      epic: epicType?.id,
      feature: featureType?.id,
      userStory: storyType?.id,
      task: taskType?.id,
      testCase: testCaseType?.id,
      subtask: subtaskType?.id,
      bug: bugType?.id,
    };

    const issueTypeNameMap: HierarchyCapability['issueTypeNameMap'] = {
      epic: epicType?.name,
      feature: featureType?.name,
      userStory: storyType?.name,
      task: taskType?.name,
      testCase: testCaseType?.name,
      subtask: subtaskType?.name,
      bug: bugType?.name,
    };

    // Attempt to maintain original hierarchy levels if possible
    const getLevel = (id?: string) => types.find(t => t.id === id)?.hierarchyLevel;

    const levels: HierarchyCapability['levels'] = {
      epic: getLevel(epicType?.id) ?? 1,
      feature: getLevel(featureType?.id),
      userStory: getLevel(storyType?.id),
      task: getLevel(taskType?.id),
      testCase: getLevel(testCaseType?.id),
      subtask: getLevel(subtaskType?.id),
    };

    const allLevels = Object.values(levels).filter((v): v is number => typeof v === 'number');
    const maxLevel = allLevels.length > 0 ? Math.max(...allLevels) : 1;

    let mode: HierarchyCapability['mode'];
    if (maxLevel >= 2 && levels.feature !== undefined && levels.userStory !== undefined && levels.feature > levels.userStory) {
      mode = 'NATIVE_4_TIER';
    } else {
      mode = 'FLAT_3_TIER';
    }

    const cap: HierarchyCapability = { mode, levels, issueTypeIdMap, issueTypeNameMap };
    this._hierarchyCapCache.set(projectKey, cap);

    console.log(`[JiraHierarchy] mode=${mode}  levels=${JSON.stringify(levels)}  typeIds=${JSON.stringify(issueTypeIdMap)}`);

    return cap;
  }

  async getStrategy(): Promise<HierarchyStrategy> {
    if (this._strategy) return this._strategy;
    const { FlatHierarchyStrategy } = await import('./strategies/flat-hierarchy-strategy');
    const { NativeHierarchyStrategy } = await import('./strategies/native-hierarchy-strategy');
    const cap = await this.getHierarchyCapability(this.config.projectKey!);
    this._strategy = cap.mode === 'NATIVE_4_TIER'
      ? new NativeHierarchyStrategy(this, cap)
      : new FlatHierarchyStrategy(this, cap);
    console.log(`[JiraService] Hierarchy strategy: ${this._strategy.mode}`);
    return this._strategy;
  }

  /**
   * List epics created by DevX (via devx-tier-epic label), with fallback to issuetype=Epic.
   */
  async listDevxEpics(): Promise<Array<{ key: string; id: string; summary: string }>> {
    const pk = this.config.projectKey!;
    try {
      const jql = `project = "${pk}" AND labels = "devx-tier-epic" ORDER BY created DESC`;
      const resp = await this.request<{ issues: any[] }>(`/search/jql`, {
        method: 'POST',
        body: JSON.stringify({ jql, maxResults: 200, fields: ['summary', 'labels'] }),
      });
      const issues = resp.issues || [];
      if (issues.length > 0) {
        return issues.map((i: any) => ({ key: i.key, id: i.id, summary: i.fields?.summary || '' }));
      }
    } catch (e) {
      console.warn(`[JiraService] listDevxEpics label query failed, falling back to issuetype:`, e instanceof Error ? e.message : e);
    }
    const fallbackJql = `project = "${pk}" AND issuetype = Epic ORDER BY created DESC`;
    const resp = await this.request<{ issues: any[] }>(`/search/jql`, {
      method: 'POST',
      body: JSON.stringify({ jql: fallbackJql, maxResults: 200, fields: ['summary'] }),
    });
    return (resp.issues || []).map((i: any) => ({ key: i.key, id: i.id, summary: i.fields?.summary || '' }));
  }

  /**
   * Get the Jira link type ID for "Tests" (preferred) or "Relates" (fallback).
   * Cached per service instance.
   */
  async getLinkTypeId(preferredName: string = 'Tests'): Promise<string> {
    if (this._linkTypeCache) {
      if (preferredName === 'Tests' && this._linkTypeCache.testsId) return this._linkTypeCache.testsId;
      return this._linkTypeCache.relatesId;
    }
    try {
      const resp = await this.request<{ issueLinkTypes: Array<{ id: string; name: string }> }>('/issueLinkType');
      const linkTypes = resp.issueLinkTypes || [];
      const testsType = linkTypes.find(lt => lt.name.toLowerCase() === 'tests');
      const relatesType = linkTypes.find(lt => lt.name.toLowerCase() === 'relates') || linkTypes[0];
      this._linkTypeCache = {
        testsId: testsType?.id || null,
        relatesId: relatesType?.id || 'Relates',
      };
    } catch (e) {
      console.warn(`[JiraService] getLinkTypeId failed:`, e instanceof Error ? e.message : e);
      this._linkTypeCache = { testsId: null, relatesId: 'Relates' };
    }
    if (preferredName === 'Tests' && this._linkTypeCache.testsId) return this._linkTypeCache.testsId;
    return this._linkTypeCache.relatesId;
  }

  /**
   * Expose the internal request method to strategy implementations.
   */
  async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, options);
  }

  /**
   * Expose projectKey to strategy implementations.
   */
  getProjectKey(): string {
    return this.config.projectKey || '';
  }

  /**
   * Expose instanceUrl to strategy implementations.
   */
  getInstanceUrl(): string {
    return this.config.instanceUrl || '';
  }
}
