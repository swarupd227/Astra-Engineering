import type { GoldenRepository } from "@shared/schema";

export const GOLDEN_REPOSITORIES_QUERY_KEY = ["/api/golden-repositories"] as const;

export type GoldenRepoProvider = "ado" | "github" | "gitlab";

export type GoldenRepositoriesResponse = {
  repositories?: GoldenRepository[];
  count?: number;
  provider?: string;
};

export type GoldenRepoReferenceLike = {
  repoId?: string;
  repoName?: string;
  filePaths?: string[];
  provider?: GoldenRepoProvider;
  repoUrl?: string;
  url?: string;
  defaultBranch?: string;
  organization?: string;
  project?: string;
};

export type GoldenRepoConfig = {
  repositoryId: string;
  organization: string;
  projectName: string;
  patToken: string;
  provider?: GoldenRepoProvider;
  url?: string;
  defaultBranch?: string;
};

export type GoldenRepoSelectorProps = {
  selectedRepoId?: string;
  selectedRepoName?: string;
  linkedGoldenRepoOrg?: string;
  linkedGoldenRepoProject?: string;
  provider?: GoldenRepoProvider;
  repoUrl?: string;
  defaultBranch?: string;
};

/** Normalize cached API payload — consumers share one query key with different shapes. */
export function extractGoldenRepositories(
  data: GoldenRepository[] | GoldenRepositoriesResponse | null | undefined,
): GoldenRepository[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.repositories)) return data.repositories;
  return [];
}

export function resolveGoldenRepoUrl(ref?: GoldenRepoReferenceLike | null): string | undefined {
  if (!ref) return undefined;
  return ref.repoUrl || ref.url || undefined;
}

function isGoldenRepoProvider(value: unknown): value is GoldenRepoProvider {
  return value === "ado" || value === "github" || value === "gitlab";
}

function inferGoldenRepoProvider(
  repoId: string | undefined,
  repoUrl: string | undefined,
  organization: string,
  project: string,
  repoName?: string,
): GoldenRepoProvider {
  const url = (repoUrl || "").toLowerCase();
  if (url.includes("gitlab")) return "gitlab";
  if (url.includes("github")) return "github";

  const text = `${organization} ${project} ${repoName || ""}`.toLowerCase();
  if (/^\d+$/.test(repoId || "") && text.includes("gitlab")) return "gitlab";
  if (/^\d+$/.test(repoId || "") && text.includes("github")) return "github";

  return "ado";
}

/** Build workflow/compliance config from project details API payload. */
export function buildGoldenRepoConfigFromProject(
  p: Record<string, unknown>,
  effectiveAdoRepositoryId?: string | null,
): GoldenRepoConfig | null {
  const ref = (p.goldenRepoReference ?? p.golden_repo_reference) as
    | GoldenRepoReferenceLike
    | undefined;
  const org =
    (p.linkedGoldenRepoOrg as string) ??
    (p.linked_golden_repo_org as string) ??
    ref?.organization ??
    "";
  const proj =
    (p.linkedGoldenRepoProject as string) ??
    (p.linked_golden_repo_project as string) ??
    ref?.project ??
    "";
  const rawRepoId =
    ref?.repoId ??
    (p.repository_id as string) ??
    (p.repositoryId as string);
  const repoUrl = resolveGoldenRepoUrl(ref);
  const provider = isGoldenRepoProvider(ref?.provider)
    ? ref.provider
    : inferGoldenRepoProvider(
      rawRepoId ? String(rawRepoId) : undefined,
      repoUrl,
      org,
      proj,
      ref?.repoName,
    );
  const repoId = provider === "ado"
    ? effectiveAdoRepositoryId ?? rawRepoId
    : rawRepoId;

  if (!repoId) return null;

  if (provider !== "ado") {
    return {
      repositoryId: String(repoId),
      organization: org,
      projectName: proj || ref?.repoName || "",
      patToken: "",
      provider,
      url: repoUrl,
      defaultBranch: ref?.defaultBranch,
    };
  }

  if (org && proj) {
    return {
      repositoryId: String(repoId),
      organization: org,
      projectName: proj,
      patToken: "",
      provider: "ado",
    };
  }

  if (ref?.repoName) {
    return {
      repositoryId: String(repoId),
      organization: org,
      projectName: proj || ref.repoName,
      patToken: "",
      provider: "ado",
    };
  }

  return null;
}

export function goldenRepoSelectorPropsFromRef(
  ref?: GoldenRepoReferenceLike | null,
): GoldenRepoSelectorProps {
  if (!ref?.repoId) return {};
  return {
    selectedRepoId: String(ref.repoId),
    selectedRepoName: ref.repoName,
    provider: ref.provider || "ado",
    repoUrl: resolveGoldenRepoUrl(ref),
    defaultBranch: ref.defaultBranch,
    linkedGoldenRepoOrg: ref.organization,
    linkedGoldenRepoProject: ref.project,
  };
}

export function goldenRepoSelectorPropsFromRepo(repo: unknown): GoldenRepoSelectorProps {
  const r = repo as Record<string, unknown> | null | undefined;
  if (!r?.id) return {};
  return {
    selectedRepoId: String(r.id),
    selectedRepoName: String(r.name || ""),
    provider: (r.provider as GoldenRepoProvider) || "ado",
    repoUrl: (r.url as string) || (r.webUrl as string) || undefined,
    defaultBranch: r.defaultBranch as string | undefined,
    linkedGoldenRepoOrg: r.organization as string | undefined,
    linkedGoldenRepoProject: r.project as string | undefined,
  };
}
