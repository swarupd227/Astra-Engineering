import type { Request, Response, NextFunction } from "express";
import { isAdoWorkItemsAllowed } from "./hosting";

/** Path fragments that indicate Azure DevOps–specific HTTP APIs (not Jira). */
const ADO_PATH_MARKERS = [
  "/ado-settings",
  "/ado/",
  "/ado-repositories",
  "/golden-repos/ado",
  "/golden-repo-organizations",
  "/golden-repos",
  "/golden-repo/",
  "/artifact-organizations",
  "/azure/",
  "push-to-ado",
  "push-test-plan-to-ado",
  "push-devops",
  "by-ado-project",
  "/sync-from-ado",
  "/ado-requirements",
  "/ado-config",
  "/ralph-loop/",
  // NOTE: "/specs/sync" is intentionally NOT blocked — spec sync (sync-status / sync-pull)
  // is provider-agnostic (GitHub / GitLab / Bitbucket / Azure Repos) and resolves the repo
  // provider from the project's integration config, so it must work outside Azure DevOps too.
  "/deployment/validate",
  "/deployment/test",
  "/deployment/trigger",
];

/**
 * When DEVX_HOSTING=aws, block ADO-centric API calls so clients cannot bypass the UI.
 */
export function adoDisabledMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isAdoWorkItemsAllowed()) {
    next();
    return;
  }
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const path = req.path;
  if (!path.startsWith("/api")) {
    next();
    return;
  }
  if (path.startsWith("/api/jira") || path.startsWith("/api/platform/") || path.startsWith("/api/github")) {
    next();
    return;
  }

  if (
    path.startsWith("/api/golden-repo/") ||
    path === "/api/golden-repos" ||
    path.startsWith("/api/golden-repos/preview") ||
    path.startsWith("/api/golden-repo-organizations") ||
    path === "/api/golden-repositories" ||
    path.startsWith("/api/gitlab/") ||
    path.startsWith("/api/ado/repository/") ||
    path === "/api/ado/golden-repositories" ||
    path === "/api/ado-settings"
  ) {
    next();
    return;
  }

  if (path === "/api/create-project" && req.method === "POST") {
    const cloud = (req.body as { cloudProvider?: string })?.cloudProvider;
    if (cloud && String(cloud).toLowerCase().includes("azure")) {
      res.status(403).json({
        error: "ado_disabled",
        message:
          "Azure DevOps project creation is not available when DEVX_HOSTING=aws. Create a Jira project instead.",
      });
      return;
    }
  }

  if (ADO_PATH_MARKERS.some((m) => path.includes(m))) {
    res.status(403).json({
      error: "ado_disabled",
      message: "Azure DevOps APIs are disabled when DEVX_HOSTING=aws. Use Jira integration.",
    });
    return;
  }

  next();
}
