import type { Request, Response, NextFunction } from "express";
import { bootstrapUser, type SSOUserInfo } from "./user-bootstrap";
import { validateIdToken } from "./jwt-validator";
import { db } from "../db";
import { users, userRoles, roles, roleActivityPermissions } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Extended Express Request with user information
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    displayName?: string;
    provider?: string;
    azureOid?: string;
    tenantId?: string;
  };
  authFailure?: {
    reason: string;
  };
}

// Throttle the JIRA membership claim so it runs at most once per window per user
// (not on every /api request).
const _jiraClaimThrottle = new Map<string, number>();
const JIRA_CLAIM_TTL_MS = 10 * 60 * 1000; // 10 min
const VIEWER_DEFAULT_DISABLED_ACTIVITIES = [
  "GOLDEN_REPOS_UPDATE",
  "GOLDEN_REPOS_DELETE",
] as const;
const NON_TENANT_ADMIN_DEFAULT_DISABLED_ACTIVITIES = [
  "GOLDEN_REPOS_CREATE",
] as const;

export async function ensureViewerGoldenRepoPermissionDefaults(
  tenantId?: string | null,
  provider?: string | null,
  roleId?: number | null,
  roleName?: string | null,
): Promise<void> {
  if (!tenantId || !provider || !roleId || roleName !== "Viewer") {
    return;
  }

  const existingRows = await db
    .select({ activityKey: roleActivityPermissions.activityKey })
    .from(roleActivityPermissions)
    .where(
      and(
        eq(roleActivityPermissions.tenantId, tenantId),
        eq(roleActivityPermissions.provider, provider),
        eq(roleActivityPermissions.roleId, roleId),
        inArray(
          roleActivityPermissions.activityKey,
          [...VIEWER_DEFAULT_DISABLED_ACTIVITIES],
        ),
      ),
    );

  const existingKeys = new Set(existingRows.map((row) => row.activityKey));
  const missingKeys = VIEWER_DEFAULT_DISABLED_ACTIVITIES.filter(
    (activityKey) => !existingKeys.has(activityKey),
  );

  if (missingKeys.length === 0) {
    return;
  }

  await db.insert(roleActivityPermissions).values(
    missingKeys.map((activityKey) => ({
      tenantId,
      provider,
      roleId,
      activityKey,
      enabled: false,
    })),
  );
}

export async function ensureNonTenantAdminGoldenRepoCreateDefaults(
  tenantId?: string | null,
  provider?: string | null,
  roleId?: number | null,
  roleName?: string | null,
): Promise<void> {
  if (!tenantId || !provider || !roleId || !roleName || roleName === "TenantAdmin") {
    return;
  }

  const existingRows = await db
    .select({ activityKey: roleActivityPermissions.activityKey })
    .from(roleActivityPermissions)
    .where(
      and(
        eq(roleActivityPermissions.tenantId, tenantId),
        eq(roleActivityPermissions.provider, provider),
        eq(roleActivityPermissions.roleId, roleId),
        inArray(
          roleActivityPermissions.activityKey,
          [...NON_TENANT_ADMIN_DEFAULT_DISABLED_ACTIVITIES],
        ),
      ),
    );

  const existingKeys = new Set(existingRows.map((row) => row.activityKey));
  const missingKeys = NON_TENANT_ADMIN_DEFAULT_DISABLED_ACTIVITIES.filter(
    (activityKey) => !existingKeys.has(activityKey),
  );

  if (missingKeys.length === 0) {
    return;
  }

  await db.insert(roleActivityPermissions).values(
    missingKeys.map((activityKey) => ({
      tenantId,
      provider,
      roleId,
      activityKey,
      enabled: false,
    })),
  );
}

function maybeClaimJiraMemberships(userId: string, email?: string): void {
  const now = Date.now();
  const last = _jiraClaimThrottle.get(userId) || 0;
  if (now - last < JIRA_CLAIM_TTL_MS) return;
  _jiraClaimThrottle.set(userId, now);
  if (_jiraClaimThrottle.size > 2000) {
    for (const [k, v] of _jiraClaimThrottle) if (now - v > JIRA_CLAIM_TTL_MS) _jiraClaimThrottle.delete(k);
  }
  import("../integrations/jira/team-sync-service")
    .then((m) => m.claimJiraMembershipsForUser({ userId, email }))
    .then((n) => { if (n > 0) console.log(`[Auth] claimed ${n} JIRA membership(s) for user ${userId}`); })
    .catch((e) => console.warn("[Auth] claimJiraMembershipsForUser failed:", e?.message || e));
}

/**
 * Middleware to authenticate users via Azure AD Bearer token.
 * Validates the JWT against Azure AD JWKS, extracts claims, and
 * bootstraps the user record in the database if it doesn't exist.
 */
export async function autoBootstrapUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    let userInfo: SSOUserInfo | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const JWT_VALIDATE_TIMEOUT = 12_000;
        const claims = await Promise.race([
          validateIdToken(token),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("request timed out")), JWT_VALIDATE_TIMEOUT)
          ),
        ]);
        userInfo = {
          azureOid: claims.oid,
          email: claims.email,
          displayName: claims.name,
          tenantId: claims.tid,
          keycloakId: claims.provider === "microsoft" || claims.provider === "cognito" ? undefined : claims.sub,
          provider: claims.provider,
        };
      } catch (err) {
        const reason = (err as Error).message;
        req.authFailure = { reason };
        console.warn("[Auth Middleware] Bearer token validation failed:", reason);
      }
    }

    // If we have validated user info, bootstrap the user
    if (userInfo && userInfo.email) {
      const maxRetries = 2;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const user = await bootstrapUser(userInfo);

          req.user = {
            id: user.id,
            email: user.email || "",
            displayName: user.displayName || undefined,
            provider: user.provider || undefined,
            azureOid: user.azureOid || undefined,
            tenantId: user.tenantId || undefined,
          };
          // Claim any unmatched JIRA memberships for this user (credential/email/
          // override). Throttled so it runs ~once per window per user, not every
          // request — closes the gap for users who existed before a project sync.
          maybeClaimJiraMemberships(user.id, user.email || undefined);
          break;
        } catch (error: any) {
          const code = error?.code ?? "";
          const isTransient = code === "ECONNRESET" || code === "HANDSHAKE_SSL_ERROR" || code === "PROTOCOL_CONNECTION_LOST" || code === "ETIMEDOUT" || code === "ECONNREFUSED";
          if (isTransient && attempt < maxRetries) {
            console.warn(`[Auth Middleware] Transient DB error (${code}), retrying (${attempt}/${maxRetries})...`);
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          console.error(`[Auth Middleware] Error bootstrapping user (attempt ${attempt}/${maxRetries}):`, error);
        }
      }
    }

    next();
  } catch (error) {
    console.error("[Auth Middleware] Unexpected error:", error);
    next();
  }
}

/**
 * Optional middleware to require authentication
 * Use this on routes that require an authenticated user
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      error: "Unauthorized",
      message: req.authFailure?.reason || "Authentication required",
    });
  }
  next();
}

/**
 * Middleware to require that the current user has completed onboarding
 * (validated their JIRA + GitLab PATs). Use after the user is populated by
 * autoBootstrapUser. Returns 403 ONBOARDING_REQUIRED if not onboarded so the
 * client can redirect to the Profile Setup page.
 */
export async function requireOnboarded(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    }

    const [row] = await db
      .select({ onboardingCompleted: users.onboardingCompleted })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!row?.onboardingCompleted) {
      return res.status(403).json({
        code: "ONBOARDING_REQUIRED",
        error: "Onboarding required",
        message: "Complete your profile setup (connect JIRA and GitLab) before continuing.",
      });
    }

    next();
  } catch (error) {
    console.error("[Auth Middleware] Error checking onboarding status:", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to verify onboarding status" });
  }
}

/**
 * Middleware to require specific role
 * Use this on routes that require specific permissions
 */
export function requireRole(allowedRoles: string[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    // if (!req.user) {
    //   return res.status(401).json({
    //     error: "Unauthorized",
    //     message: "Authentication required",
    //   });
    // }

    // Fetch user roles from database, resolving role names via join.
    // We intentionally resolve via the `roles` table instead of relying on any
    // denormalized columns to keep RBAC semantics consistent across the app.
    const userRolesList = await db
      .select({
        roleName: roles.name,
      })
      .from(userRoles)
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, req.user.id));

    const userRoleNames = userRolesList
      .map((r) => r.roleName)
      .filter((name): name is string => Boolean(name));

    // Check if user has any of the allowed roles
    const hasRequiredRole = allowedRoles.some((role) =>
      userRoleNames.includes(role)
    );

    if (!hasRequiredRole) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Required role: ${allowedRoles.join(" or ")}`,
      });
    }

    next();
  };
}

/**
 * Check if a user has an activity enabled.
 * Logic:
 *  1. Get user's role IDs from user_roles table
 *  2. Look up role_activity_permissions for those role IDs + activityKey
 *  3. If any row has enabled=0 (false) → activity is DISABLED
 *  4. All other cases (no row, or enabled=1) → activity is ENABLED
 */
export async function hasActivityEnabled(userId: string, activityKey: string): Promise<boolean> {
  // Step 1: Get user's tenantId
  const userRecord = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const tenantId = userRecord[0]?.tenantId;

  // Step 2: Get user's roles scoped to their tenant
  let userRoleRows = await db
    .select({
      roleId: userRoles.roleId,
      tenantId: userRoles.tenantId,
      provider: userRoles.provider,
      roleName: roles.name,
    })
    .from(userRoles)
    .leftJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      tenantId
        ? and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId))
        : eq(userRoles.userId, userId)
    );

  // Fallback: if no roles found with tenant scope, try without tenant filter.
  // Handles data mismatch where users.tenantId doesn't match user_roles.tenantId.
  if (userRoleRows.length === 0 && tenantId) {
    userRoleRows = await db
      .select({
        roleId: userRoles.roleId,
        tenantId: userRoles.tenantId,
        provider: userRoles.provider,
        roleName: roles.name,
      })
      .from(userRoles)
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
  }

  if (userRoleRows.length === 0) {
    return false;
  }

  const viewerDefaultTargets = new Map<
    string,
    { tenantId: string; provider: string; roleId: number; roleName: string }
  >();

  for (const row of userRoleRows) {
    if (!row.tenantId || !row.provider || !row.roleName) {
      continue;
    }
    viewerDefaultTargets.set(
      `${row.tenantId}:${row.provider}:${row.roleId}:${row.roleName}`,
      {
        tenantId: row.tenantId,
        provider: row.provider,
        roleId: row.roleId,
        roleName: row.roleName,
      },
    );
  }

  await Promise.all(
    Array.from(viewerDefaultTargets.values()).map(async (row) => {
      await ensureViewerGoldenRepoPermissionDefaults(
        row.tenantId,
        row.provider,
        row.roleId,
        row.roleName,
      );
      await ensureNonTenantAdminGoldenRepoCreateDefaults(
        row.tenantId,
        row.provider,
        row.roleId,
        row.roleName,
      );
    }),
  );

  const roleIds = userRoleRows.map((row) => row.roleId);
  const permissionTenantId = userRoleRows[0]?.tenantId ?? tenantId;
  const permissionProvider = userRoleRows[0]?.provider;
  const scopedPermissionFilters: Array<ReturnType<typeof eq>> = [];

  if (permissionTenantId) {
    scopedPermissionFilters.push(eq(roleActivityPermissions.tenantId, permissionTenantId));
  }
  if (permissionProvider) {
    scopedPermissionFilters.push(eq(roleActivityPermissions.provider, permissionProvider));
  }

  // Step 3: If user has TenantAdmin role, check ONLY TenantAdmin's activity permission.
  // TenantAdmin overrides all other roles — other roles' disabled rows are ignored.
  const tenantAdminRole = userRoleRows.find((row) => row.roleName === "TenantAdmin");

  if (tenantAdminRole) {
    const disabledForAdmin = await db
      .select({ enabled: roleActivityPermissions.enabled })
      .from(roleActivityPermissions)
      .where(
        and(
          ...scopedPermissionFilters,
          eq(roleActivityPermissions.roleId, tenantAdminRole.roleId),
          eq(roleActivityPermissions.activityKey, activityKey),
          eq(roleActivityPermissions.enabled, false)
        )
      )
      .limit(1);
    // No row = enabled by default; row with enabled=0 = explicitly disabled
    return disabledForAdmin.length === 0;
  }

  // Step 4: For non-TenantAdmin users, check all their roles.
  // If any role has enabled=0, the activity is disabled.
  const disabledRow = await db
    .select({ enabled: roleActivityPermissions.enabled })
    .from(roleActivityPermissions)
    .where(
      and(
        ...scopedPermissionFilters,
        inArray(roleActivityPermissions.roleId, roleIds),
        eq(roleActivityPermissions.activityKey, activityKey),
        eq(roleActivityPermissions.enabled, false)
      )
    )
    .limit(1);

  // Step 5: If a disabled row exists → not allowed; otherwise → allowed
  return disabledRow.length === 0;
}

/**
 * Middleware to require that the current user has the given activity enabled (per role_activity_permissions).
 * Use after requireAuth so req.user is set.
 */
export function requireActivity(activityKey: string) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required",
        });
      }

      const allowed = await hasActivityEnabled(req.user.id, activityKey);
      if (!allowed) {
        return res.status(403).json({
          error: "Forbidden",
          message: `Activity "${activityKey}" is not enabled for your role(s). Contact your administrator.`,
        });
      }

      next();
    } catch (error) {
      console.error(`[Auth Middleware] Error checking activity ${activityKey}:`, error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to verify activity permissions",
      });
    }
  };
}
