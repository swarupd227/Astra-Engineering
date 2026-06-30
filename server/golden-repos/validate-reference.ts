export type GoldenRepoReference = {
  repoId: string;
  repoName: string;
  filePaths: string[];
  provider?: "ado" | "github" | "gitlab";
  repoUrl?: string;
  defaultBranch?: string;
};

/** ADO uses UUIDs; GitLab/GitHub use numeric or other stable external IDs. */
export function isValidGoldenRepoId(repoId: string): boolean {
  if (typeof repoId !== "string" || !repoId.trim()) return false;
  const id = repoId.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return true;
  }
  if (/^\d+$/.test(id)) return true;
  if (/^[a-zA-Z0-9._:-]+$/.test(id) && id.length <= 255) return true;
  return false;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInStarterCode(path: string): boolean {
  return normalizePath(path).split("/").includes("Starter Code");
}

export function validateGoldenRepoReference(
  golden_repo_reference: unknown,
):
  | { ok: true; value: GoldenRepoReference }
  | { ok: false; error: string; status: number } {
  if (!golden_repo_reference) {
    return { ok: false, error: "golden_repo_reference is required", status: 400 };
  }

  if (
    typeof golden_repo_reference !== "object" ||
    !(golden_repo_reference as GoldenRepoReference).repoId ||
    !(golden_repo_reference as GoldenRepoReference).repoName ||
    !Array.isArray((golden_repo_reference as GoldenRepoReference).filePaths)
  ) {
    return {
      ok: false,
      error:
        "Invalid golden_repo_reference format. Expected { repoId: string, repoName: string, filePaths: string[] }",
      status: 400,
    };
  }

  const ref = golden_repo_reference as GoldenRepoReference;
  const repoId = String(ref.repoId).trim();

  if (!isValidGoldenRepoId(repoId)) {
    return {
      ok: false,
      error: "Invalid repoId format. Expected ADO UUID or Git provider project ID.",
      status: 400,
    };
  }

  const normalizedPaths: string[] = [];
  for (const filePath of ref.filePaths) {
    if (typeof filePath !== "string") {
      return { ok: false, error: "All filePaths must be strings", status: 400 };
    }
    const normalized = normalizePath(filePath);
    if (isInStarterCode(normalized)) {
      return {
        ok: false,
        error: `File path "${filePath}" is in "Starter Code" folder and cannot be selected`,
        status: 400,
      };
    }
    normalizedPaths.push(normalized);
  }

  const value: GoldenRepoReference = {
    repoId,
    repoName: String(ref.repoName).trim(),
    filePaths: normalizedPaths,
  };

  if (ref.provider === "ado" || ref.provider === "github" || ref.provider === "gitlab") {
    value.provider = ref.provider;
  }
  if (typeof ref.repoUrl === "string" && ref.repoUrl.trim()) {
    value.repoUrl = ref.repoUrl.trim();
  }
  if (typeof ref.defaultBranch === "string" && ref.defaultBranch.trim()) {
    value.defaultBranch = ref.defaultBranch.trim();
  }

  return { ok: true, value };
}
