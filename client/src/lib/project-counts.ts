import { getApiUrl } from "@/lib/api-config";

export const ADO_PROJECTS_API_ROOT = "/api/ado-projects";
export const OVERVIEW_PROJECT_COUNT_KEY = "overview-count";
export const ORGANIZATION_CARD_COUNTS_KEY = "organization-card-counts";

export type OrganizationProjectCounts = Record<
  string,
  { count: number; error?: string }
>;

export type AdoProjectsQueryOptions = {
  org: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDirection?: string;
  search?: string;
  syncFilter?: string;
  organizationFilter?: string;
};

/** Shared query params so overview, projects, and organization cards use one listing. */
export function buildAdoProjectsQueryParams(
  options: AdoProjectsQueryOptions
): URLSearchParams {
  const params = new URLSearchParams();
  const org =
    !options.org || options.org === "__all__" ? "all" : options.org;

  params.set("org", org);
  params.set("paginated", "true");
  params.set("page", String(options.page ?? 1));
  params.set("limit", String(options.pageSize ?? 20));
  params.set("pageSize", String(options.pageSize ?? 20));
  params.set("sortBy", options.sortField ?? "name");
  params.set("sortField", options.sortField ?? "name");
  params.set("sortDirection", options.sortDirection ?? "asc");
  params.set("syncStatus", options.syncFilter ?? "all");
  params.set("syncFilter", options.syncFilter ?? "all");
  params.set("organization", options.organizationFilter ?? "all");
  params.set("organizationFilter", options.organizationFilter ?? "all");

  if (options.search?.trim()) {
    params.set("search", options.search.trim());
  }

  return params;
}

export function buildAdoProjectsQueryUrl(
  options: AdoProjectsQueryOptions
): string {
  return `${ADO_PROJECTS_API_ROOT}?${buildAdoProjectsQueryParams(options).toString()}`;
}

export async function fetchProjectCountForOrg(
  org: string,
  options?: Omit<AdoProjectsQueryOptions, "org" | "page" | "pageSize">
): Promise<number> {
  const url = buildAdoProjectsQueryUrl({
    org,
    page: 1,
    pageSize: 1,
    ...options,
  });

  const response = await fetch(getApiUrl(url), { credentials: "include" });
  if (!response.ok) {
    return 0;
  }

  const data = await response.json();
  return data.totalCount ?? data.projects?.length ?? 0;
}

export async function fetchOrganizationProjectCounts(
  orgIds: string[]
): Promise<OrganizationProjectCounts> {
  if (orgIds.length === 0) {
    return {};
  }

  const entries = await Promise.all(
    orgIds.map(async (orgId) => {
      try {
        const count = await fetchProjectCountForOrg(orgId);
        return [orgId, { count }] as const;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to fetch";
        return [orgId, { count: 0, error: message }] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

export function sumOrganizationProjectCounts(
  counts: OrganizationProjectCounts,
  orgIds: string[]
): number {
  return orgIds.reduce((sum, orgId) => sum + (counts[orgId]?.count ?? 0), 0);
}

export function normalizeOrgUrl(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export type ProjectOrgScope = {
  jiraConnectionId?: string | null;
  artifactOrgId?: string | null;
  jiraInstanceUrl?: string | null;
  organization?: string | null;
  organizationUrl?: string | null;
  integrationType?: string | null;
};

export type OrganizationScopeContext = {
  integrationType?: string;
  instanceUrl?: string;
  organizationUrl?: string;
};

export function projectBelongsToOrganization(
  project: ProjectOrgScope,
  orgId: string,
  orgContext?: OrganizationScopeContext | null
): boolean {
  if (project.jiraConnectionId === orgId || project.artifactOrgId === orgId) {
    return true;
  }

  if (!orgContext) {
    return false;
  }

  if (orgContext.integrationType === "jira" && project.integrationType === "jira") {
    const orgUrl = normalizeOrgUrl(
      orgContext.instanceUrl || orgContext.organizationUrl
    );
    const projectUrls = [project.jiraInstanceUrl, project.organizationUrl, project.organization]
      .filter(Boolean)
      .map((value) => normalizeOrgUrl(String(value)));
    return orgUrl.length > 0 && projectUrls.some((url) => url === orgUrl);
  }

  if (orgContext.integrationType !== "jira" && project.integrationType !== "jira") {
    const orgUrl = normalizeOrgUrl(orgContext.organizationUrl);
    const projectOrg = normalizeOrgUrl(project.organization || project.organizationUrl);
    return orgUrl.length > 0 && projectOrg.length > 0 && projectOrg === orgUrl;
  }

  return false;
}

export function projectCountQueryPredicate(query: { queryKey: unknown }) {
  return (
    typeof query.queryKey === "object" &&
    query.queryKey !== null &&
    Array.isArray(query.queryKey) &&
    typeof query.queryKey[0] === "string" &&
    (query.queryKey[0] as string).startsWith(ADO_PROJECTS_API_ROOT)
  );
}
