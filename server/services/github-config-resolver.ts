/**
 * Resolves GitHub configuration for a tenant.
 * Priority: 1) DB integrations table (tenant-level)  2) process.env fallback
 *
 * Column mapping in the `integrations` table (integrationType = 'github'):
 *   apiKey  → GitHub Personal Access Token
 *   appKey  → Owner / Organisation
 *   baseUrl → Default repository name
 */

import { db } from "../db";
import { integrations } from "@shared/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Return GitHub connection details for the given tenant, falling back to env vars.
 * When `tenantId` is undefined / null the function returns env-only config.
 */
export async function getGitHubConfig(tenantId?: string | null): Promise<GitHubConfig> {
  if (tenantId) {
    try {
      const rows = await db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.tenantId, tenantId),
            eq(integrations.integrationType, "github"),
            eq(integrations.status, "active"),
            isNull(integrations.projectId),
            isNull(integrations.organizationId),
          ),
        )
        .orderBy(desc(integrations.updatedAt))
        .limit(1);

      let row = rows[0];
      if (!row) {
        const legacyRows = await db
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.tenantId, tenantId),
              eq(integrations.integrationType, "github"),
              eq(integrations.status, "active"),
            ),
          )
          .orderBy(desc(integrations.updatedAt))
          .limit(1);
        row = legacyRows[0];
      }

      if (row) {
        console.log(`[GitHubConfig] Using DB config for tenant ${tenantId}`);
        return {
          token: row.apiKey,
          owner: row.appKey || "",
          repo: row.baseUrl || process.env.GITHUB_REPO || "",
          branch: process.env.GITHUB_BRANCH || "main",
        };
      }
    } catch (err: any) {
      const code = err?.code ?? err?.errno;
      if (
        code === "ER_NO_SUCH_TABLE" ||
        code === "ER_BAD_TABLE_ERROR" ||
        (typeof err?.message === "string" && err.message.includes("integrations"))
      ) {
        // Table hasn't been created yet – fall through to env
      } else {
        console.error("[GitHubConfig] DB lookup error, falling back to env:", err.message);
      }
    }
  }

  console.log(
    `[GitHubConfig] No DB config found for tenant ${tenantId ?? "(none)"}, falling back to env`,
  );

  return {
    token: process.env.GITHUB_TOKEN || "",
    owner: process.env.GITHUB_OWNER || "",
    repo: process.env.GITHUB_REPO || "",
    branch: process.env.GITHUB_BRANCH || "main",
  };
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Helper: extract tenantId from the authenticated request.
 * Follows the same pattern used in integrationsRoutes.ts.
 */
export async function getTenantIdFromRequest(req: any): Promise<string | null> {
  const requestTenantId =
    cleanString(req.user?.tenantId) ||
    cleanString(req.user?.tenant_id) ||
    cleanString(req.tenantId);
  if (requestTenantId) return requestTenantId;

  const userId = cleanString(req.user?.id) || cleanString(req.user?.userId);
  const userEmail = cleanString(req.user?.email);
  const provider = cleanString(req.user?.provider);
  if (!userId && !userEmail) return null;

  try {
    const { users } = await import("@shared/schema");
    if (userId) {
      const rows = await db
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (rows[0]?.tenantId) return rows[0].tenantId;
    }

    if (userEmail) {
      const rows = await db
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(
          provider
            ? and(
                sql`lower(${users.email}) = ${userEmail.toLowerCase()}`,
                eq(users.provider, provider),
              )
            : sql`lower(${users.email}) = ${userEmail.toLowerCase()}`,
        )
        .orderBy(desc(users.createdAt))
        .limit(1);
      return rows[0]?.tenantId ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
