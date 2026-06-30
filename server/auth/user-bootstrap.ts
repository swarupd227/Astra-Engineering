import { db, poolConnection } from "../db";
import { users, userRoles, organizations, roles, tenants } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ensureTenantSubscription } from "./subscription-bootstrap";

const MYSQL_ER_DUP_ENTRY = 1062;

/** Fallback role id for OrgAdmin in environments with legacy seeded IDs. */
const DEFAULT_ROLE_ID = 2;

async function resolveOrgAdminRoleId(): Promise<number | null> {
  const orgAdminRole = (
    await db.select().from(roles).where(eq(roles.name, "OrgAdmin")).limit(1)
  )[0];

  if (orgAdminRole) {
    return orgAdminRole.id;
  }

  // Fallback for environments where role names differ but ids are stable.
  const fallbackRole = (
    await db.select().from(roles).where(eq(roles.id, DEFAULT_ROLE_ID)).limit(1)
  )[0];
  if (fallbackRole) {
    console.warn("[UserBootstrap] OrgAdmin role name missing; using fallback role id", {
      fallbackRoleId: DEFAULT_ROLE_ID,
      fallbackRoleName: fallbackRole.name,
    });
    return fallbackRole.id;
  }

  return null;
}

/**
 * SSO User information extracted from authentication token
 */
export interface SSOUserInfo {
  azureOid?: string; // Azure AD Object ID / Cognito sub
  githubId?: string; // GitHub user ID
  keycloakId?: string; // Generic OIDC / Keycloak subject
  email: string;
  displayName?: string;
  tenantId?: string; // Azure AD Tenant ID / Cognito User Pool ID
  provider: string;
}

/**
 * Resolve tenant ID from login token (Azure tid claim) or header.
 * Priority:
 * 1. tenantId from token claims (Azure tid) - PRIMARY SOURCE
 * 2. x-tenant-id header (if provided)
 * 3. For GitHub: derive from email domain (fallback only)
 * 
 * DO NOT create random tenant IDs - they must come from login token.
 * 
 * @param tenantIdFromToken - Tenant ID from login token (Azure tid claim)
 * @param tenantIdFromHeader - Optional tenant ID from x-tenant-id header
 * @param email - User email address (for GitHub fallback only)
 * @returns Resolved tenant ID (UUID)
 */
async function resolveTenant(
  tenantIdFromToken: string | undefined,
  tenantIdFromHeader: string | undefined,
  email: string
): Promise<string> {
  // Priority 1: Use tenant ID from login token (Azure tid claim) - PRIMARY SOURCE
  if (tenantIdFromToken && tenantIdFromToken.trim().length > 0) {
    // Validate tenant ID format (should be UUID/GUID format, 36 chars with hyphens)
    const trimmedTenantId = tenantIdFromToken.trim();
    
    // Ensure tenant ID is valid format (UUID should be 36 chars)
    if (trimmedTenantId.length === 0) {
      console.warn("[TenantResolution] Empty tenant ID from token, falling back to header/email");
    } else {
      // Check if tenant exists by ID
      const existingTenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, trimmedTenantId))
        .limit(1);
      
      if (existingTenant[0]) {
        await ensureTenantSubscription(existingTenant[0].id);
        return existingTenant[0].id;
      }
      
      // Tenant ID from token doesn't exist in DB - create it with the ID from token
      // This ensures tenant ID matches what Azure AD provided
      // Note: Azure tenant IDs are GUIDs (36 chars), but we'll accept any non-empty string
      if (trimmedTenantId.length > 36) {
        console.warn(`[TenantResolution] Azure tenant ID length is ${trimmedTenantId.length}, truncating to 36 chars`);
        const truncatedId = trimmedTenantId.slice(0, 36);
        // Try with truncated ID
        const existingTruncated = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, truncatedId))
          .limit(1);
        if (existingTruncated[0]) {
          await ensureTenantSubscription(existingTruncated[0].id);
          return existingTruncated[0].id;
        }
        // Use truncated ID
        try {
          await db.insert(tenants).values({
            id: truncatedId,
            name: `tenant-${truncatedId.slice(0, 8)}`,
            status: "active",
          });
          await ensureTenantSubscription(truncatedId);
          return truncatedId;
        } catch (err: any) {
          if (err?.errno === MYSQL_ER_DUP_ENTRY || err?.code === "ER_DUP_ENTRY") {
            const fetched = await db.select().from(tenants).where(eq(tenants.id, truncatedId)).limit(1);
            if (fetched[0]) {
              await ensureTenantSubscription(fetched[0].id);
              return fetched[0].id;
            }
          }
          throw err;
        }
      }
      
      // Ensure tenant ID is valid before insert
      if (!trimmedTenantId || trimmedTenantId.length === 0) {
        throw new Error("Invalid tenant ID: empty or null");
      }
      
      try {
        const tenantInsertValues = {
          id: trimmedTenantId, // Use the tenant ID from token, not random UUID
          name: `tenant-${trimmedTenantId.slice(0, 8)}`, // Generate a name from ID
          status: "active" as const,
        };
        
        // Double-check id is set
        if (!tenantInsertValues.id) {
          throw new Error("Tenant ID is required but was not provided");
        }
        
        await db.insert(tenants).values(tenantInsertValues);
        await ensureTenantSubscription(trimmedTenantId);
        return trimmedTenantId;
      } catch (insertErr: any) {
        // Handle race condition: if another request created the tenant, fetch it
        if (insertErr?.errno === MYSQL_ER_DUP_ENTRY || insertErr?.code === "ER_DUP_ENTRY") {
          const fetchedTenants = await db
            .select()
            .from(tenants)
            .where(eq(tenants.id, trimmedTenantId))
            .limit(1);
          if (fetchedTenants[0]) {
            await ensureTenantSubscription(fetchedTenants[0].id);
            return fetchedTenants[0].id;
          }
        }
        // Log detailed error for debugging
        console.error("[TenantResolution] Error creating tenant:", {
          tenantId: trimmedTenantId,
          tenantIdLength: trimmedTenantId.length,
          error: insertErr.message,
          errno: insertErr.errno,
          code: insertErr.code,
          sqlState: insertErr.sqlState,
        });
        throw insertErr;
      }
    }
  }
  
  // Priority 2: Use header if provided (fallback)
  if (tenantIdFromHeader) {
    const existingTenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantIdFromHeader))
      .limit(1);
    
    if (existingTenant[0]) {
      await ensureTenantSubscription(existingTenant[0].id);
      return existingTenant[0].id;
    }
  }
  
  // Priority 3: For GitHub (no tenant ID in token), derive from email domain
  // This is a fallback only for GitHub OAuth
  const emailParts = email.split("@");
  if (emailParts.length !== 2) {
    throw new Error(`Invalid email format: ${email}`);
  }
  const tenantName = emailParts[1].toLowerCase();
  
  // Look up tenant by name
  const existingTenants = await db
    .select()
    .from(tenants)
    .where(eq(tenants.name, tenantName))
    .limit(1);
  
  if (existingTenants[0]) {
    await ensureTenantSubscription(existingTenants[0].id);
    return existingTenants[0].id;
  }
  
  // For GitHub: create tenant with name from email domain
  // For Azure: this should never happen (tenant ID should be in token)
  const tenantId = randomUUID();
  try {
    await db.insert(tenants).values({
      id: tenantId,
      name: tenantName,
      status: "active",
    });
    await ensureTenantSubscription(tenantId);
    return tenantId;
  } catch (insertErr: any) {
    if (insertErr?.errno === MYSQL_ER_DUP_ENTRY || insertErr?.code === "ER_DUP_ENTRY") {
      const fetchedTenants = await db
        .select()
        .from(tenants)
        .where(eq(tenants.name, tenantName))
        .limit(1);
      if (fetchedTenants[0]) {
        await ensureTenantSubscription(fetchedTenants[0].id);
        return fetchedTenants[0].id;
      }
    }
    throw insertErr;
  }
}

/**
 * Bootstrap a user after successful SSO login.
 * 
 * Flow (Phase 2 - Tenant-scoped user tracking):
 * 1. Resolve tenant (create if not exists) - Priority: token tenantId > header > email domain
 * 2. Check if user exists for THIS tenant (tenant_id + provider + provider_user_id)
 * 3. If user exists for this tenant: reactivate when soft-deleted, then return
 * 4. If user doesn't exist for this tenant (new user):
 *    - Insert new user record with tenant_id
 *    - Assign OrgAdmin by default (non-invited first-time login)
 * 5. Always allow login to continue
 * 
 * Identity Key: (tenant_id, provider, provider_user_id)
 * - Same email can exist in multiple tenants
 * - Never deduplicate users across tenants
 */
export async function bootstrapUser(userInfo: SSOUserInfo, tenantIdFromHeader?: string) {
  const provider = userInfo.provider;
  const providerUserId = userInfo.azureOid || userInfo.githubId || userInfo.keycloakId;
  if (!providerUserId) {
    throw new Error("provider_user_id is required (Azure oid, GitHub user id, or OIDC subject)");
  }

  // Step 1: Resolve tenant FIRST (create if not exists)
  // Priority: tenant ID from token (userInfo.tenantId) > header > email domain (GitHub only)
  if (!userInfo.tenantId && !tenantIdFromHeader) {
    console.warn("[UserBootstrap] No tenant ID from token or header, will use email domain fallback (GitHub only)");
  }
  
  const resolvedTenantId = await resolveTenant(
    userInfo.tenantId, // Tenant ID from login token (Azure tid claim)
    tenantIdFromHeader, // Fallback: header
    userInfo.email // Fallback: email domain (GitHub only)
  );
  
  if (!resolvedTenantId) {
    throw new Error("Failed to resolve tenant ID");
  }

  // Verify tenant exists in tenants table (should exist after resolveTenant, but double-check)
  const tenantCheck = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, resolvedTenantId))
    .limit(1);
  
  if (tenantCheck.length === 0) {
    throw new Error(`Tenant ${resolvedTenantId} does not exist in tenants table`);
  }

  // Step 2: Check if user exists for THIS SPECIFIC TENANT (tenant_id + provider + provider_user_id)
  // This is the identity key per Phase 2 requirements - allows same email across tenants
  const existingUser = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, resolvedTenantId),
        eq(users.provider, provider),
        eq(users.providerUserId, providerUserId)
      )
    )
    .limit(1);

  // Step 3: If user exists for this tenant, return immediately.
  // If soft-deleted, reactivate on successful login while preserving existing roles.
  if (existingUser[0]) {
    if (existingUser[0].isDeleted) {
      await db
        .update(users)
        .set({ isDeleted: false, deletedAt: null })
        .where(eq(users.id, existingUser[0].id));
      const reactivated = await db
        .select()
        .from(users)
        .where(eq(users.id, existingUser[0].id))
        .limit(1);
      return reactivated[0] ?? existingUser[0];
    }
    return existingUser[0];
  }

  // Step 3a: Backfill — existing user with tenant_id null (legacy pre-tenant rows). Update and return.
  let userWithNullTenant = await db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.tenantId),
        eq(users.provider, provider),
        eq(users.providerUserId, providerUserId)
      )
    )
    .limit(1);

  // Also find legacy "azure" rows with null tenant when current provider is "microsoft" or "cognito"
  if (!userWithNullTenant[0] && (provider === "microsoft" || provider === "cognito")) {
    userWithNullTenant = await db
      .select()
      .from(users)
      .where(
        and(
          isNull(users.tenantId),
          eq(users.provider, "azure"),
          eq(users.providerUserId, providerUserId)
        )
      )
      .limit(1);
  }

  if (userWithNullTenant[0]) {
    const uid = userWithNullTenant[0].id;
    const updates: { tenantId: string; provider?: string } = { tenantId: resolvedTenantId };
    if (userWithNullTenant[0].provider === "azure" && provider === "microsoft") {
      updates.provider = "microsoft";
    }
    await db.update(users).set(updates).where(eq(users.id, uid));
    // Align user_roles.tenant_id (and provider if migrated) for this user so role resolution works
    const roleUpdates: { tenantId: string; provider?: string } = { tenantId: resolvedTenantId };
    if (userWithNullTenant[0].provider === "azure" && provider === "microsoft") {
      roleUpdates.provider = "microsoft";
    }
    await db.update(userRoles).set(roleUpdates).where(eq(userRoles.userId, uid));
    const updated = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    console.log("[UserBootstrap] Backfilled tenant_id for existing user (was null):", {
      userId: uid,
      email: updated[0]?.email,
      tenantId: resolvedTenantId,
    });
    return updated[0]!;
  }

  // Step 3b: Fallback for legacy "azure" provider - middleware used to pass "azure", now passes "microsoft"
  // If we looked for "microsoft" and didn't find, try "azure" and migrate to "microsoft"
  if (provider === "microsoft") {
    const azureUser = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, resolvedTenantId),
          eq(users.provider, "azure"),
          eq(users.providerUserId, providerUserId)
        )
      )
      .limit(1);
    if (azureUser[0]) {
      const uid = azureUser[0].id;
      await db.update(users).set({ provider: "microsoft" }).where(eq(users.id, uid));
      await db
        .update(userRoles)
        .set({ provider: "microsoft" })
        .where(and(eq(userRoles.userId, uid), eq(userRoles.provider, "azure")));
      const updated = await db.select().from(users).where(eq(users.id, uid)).limit(1);
      console.log("[UserBootstrap] Migrated legacy azure user to microsoft:", { userId: uid });
      return updated[0];
    }
  }

  // Step 3c: Claim an admin pre-provisioned user row.
  // Admin User Access creates invited users before their first SSO login, using
  // provider_user_id=email as a temporary identity. On first OIDC/MSAL/Cognito
  // login, replace that placeholder with the real provider subject so the user
  // keeps the roles assigned by the tenant admin instead of getting a duplicate row.
  const preProvisionedUser = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, resolvedTenantId),
        eq(users.provider, provider),
        eq(users.providerUserId, userInfo.email),
        eq(users.email, userInfo.email),
      )
    )
    .limit(1);

  if (preProvisionedUser[0]) {
    const uid = preProvisionedUser[0].id;
    const updates: {
      providerUserId: string;
      displayName?: string;
      azureOid?: string;
    } = { providerUserId };
    if (userInfo.displayName) updates.displayName = userInfo.displayName;
    if (userInfo.azureOid) updates.azureOid = userInfo.azureOid;

    await db
      .update(users)
      .set({
        ...updates,
        isDeleted: false,
        deletedAt: null,
      })
      .where(eq(users.id, uid));
    const updated = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    console.log("[UserBootstrap] Claimed admin pre-provisioned user:", {
      userId: uid,
      email: updated[0]?.email,
      tenantId: resolvedTenantId,
      provider,
    });
    return updated[0]!;
  }

  // Step 4: New user for this tenant - insert user record
  const userId = randomUUID();
  const azureOid =
    userInfo.azureOid ||
    `pseudo-${Buffer.from(userInfo.email).toString("hex").slice(0, 80)}`;

  try {
    await db.insert(users).values({
      id: userId,
      azureOid,
      email: userInfo.email,
      displayName: userInfo.displayName || userInfo.email,
      tenantId: resolvedTenantId,
      provider,
      providerUserId: providerUserId,
    });
  } catch (insertErr: any) {
    // Some environments have NOT NULL `username` and/or `password` columns on `users` with no default.
    // In those cases, populate sensible values derived from the SSO info using a raw INSERT.
    if (
      (insertErr?.code === "ER_NO_DEFAULT_FOR_FIELD" || insertErr?.errno === 1364) &&
      typeof insertErr?.sqlMessage === "string" &&
      (insertErr.sqlMessage.includes("Field 'username' doesn't have a default value") ||
        insertErr.sqlMessage.includes("Field 'password' doesn't have a default value"))
    ) {
      const username =
        (userInfo.displayName && userInfo.displayName.trim()) ||
        (userInfo.email?.split("@")[0] || userInfo.email) ||
        azureOid;
      // Password is not used for SSO auth; store a strong random placeholder to satisfy NOT NULL.
      const passwordPlaceholder = `sso_${randomUUID()}`;

      await poolConnection.execute(
        `INSERT INTO users (id, azure_oid, email, display_name, tenant_id, provider, provider_user_id, username, password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          azureOid,
          userInfo.email,
          userInfo.displayName || userInfo.email,
          resolvedTenantId,
          provider,
          providerUserId,
          username,
          passwordPlaceholder,
        ],
      );
    } else if (insertErr?.errno === MYSQL_ER_DUP_ENTRY || insertErr?.code === "ER_DUP_ENTRY") {
      // Handle duplicate entry - could be on (tenant_id, provider, provider_user_id) OR azure_oid
      console.log("[UserBootstrap] Duplicate entry detected, fetching existing user");

      // First try: fetch by identity key (tenant_id, provider, provider_user_id)
      const fetchedByIdentity = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.tenantId, resolvedTenantId),
            eq(users.provider, provider),
            eq(users.providerUserId, providerUserId)
          )
        )
        .limit(1);

      if (fetchedByIdentity[0]) {
        console.log("[UserBootstrap] Found user by identity key:", { userId: fetchedByIdentity[0].id });
        return fetchedByIdentity[0];
      }

      // Second try: fetch by azure_oid (in case user exists in different tenant)
      if (userInfo.azureOid) {
        const fetchedByAzureOid = await db
          .select()
          .from(users)
          .where(eq(users.azureOid, userInfo.azureOid))
          .limit(1);

        if (fetchedByAzureOid[0]) {
          console.log("[UserBootstrap] Found user by azure_oid in different tenant:", {
            userId: fetchedByAzureOid[0].id,
            existingTenant: fetchedByAzureOid[0].tenantId,
            requestedTenant: resolvedTenantId
          });

          // User exists with same azure_oid but different tenant
          // This shouldn't happen in normal flow, but handle gracefully
          // Return the existing user to allow login to proceed
          return fetchedByAzureOid[0];
        }
      }

      console.error("[UserBootstrap] Duplicate entry but could not find existing user");
    } else {
      throw insertErr;
    }
  }

  const newUsers = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const createdUser = newUsers[0];
  if (!createdUser) {
    throw new Error("Failed to create user");
  }

  // New Cognito user: instantly claim any still-unmatched JIRA team memberships
  // that belong to them (by connected PAT / override / email). Fire-and-forget so
  // login is never blocked or failed by this.
  import("../integrations/jira/team-sync-service")
    .then((m) => m.claimJiraMembershipsForUser({ userId: createdUser.id, email: createdUser.email || undefined }))
    .then((n) => { if (n > 0) console.log(`[UserBootstrap] claimed ${n} JIRA membership(s) for new user ${createdUser.id}`); })
    .catch((e) => console.warn("[UserBootstrap] claimJiraMembershipsForUser failed:", e?.message || e));

  // Step 5: Assign OrgAdmin role for newly inserted users (best-effort, never block)
  try {
    const provider = userInfo.provider;
    if (!provider) {
      throw new Error("Provider could not be determined for role assignment");
    }

    // Use resolved tenant ID (always available now)
    const tenantId = resolvedTenantId;

    // 1) Resolve organization for role scope: lookup or create by tenant
    let organizationId: string | null = null;

    const orgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.tenantId, tenantId))
      .limit(1);

    if (orgs.length > 0) {
      organizationId = orgs[0].id;
    } else {
      const newOrgId = randomUUID();
      await db.insert(organizations).values({
        id: newOrgId,
        tenantId: tenantId,
        name: `Organization ${tenantId}`,
      });
      organizationId = newOrgId;
    }

    if (!organizationId) {
      console.warn("[UserBootstrap] Could not resolve or create organization; skipping role assignment");
      return createdUser;
    }

    // 2) Resolve OrgAdmin role for first-time non-invited users.
    const roleIdToAssign = await resolveOrgAdminRoleId();

    // 3) Resolve the selected role (by id)
    const defaultRole = roleIdToAssign
      ? (await db.select().from(roles).where(eq(roles.id, roleIdToAssign)).limit(1))[0]
      : null;

    if (!defaultRole) {
      console.warn("[UserBootstrap] Role not found; skipping role assignment", {
        roleId: roleIdToAssign,
      });
      return createdUser;
    }
    const resolvedRoleId = defaultRole.id;

    // 4) Check if user already has this role at this scope
    const existingRoles = await db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, createdUser.id),
          eq(userRoles.roleId, resolvedRoleId),
          eq(userRoles.scopeType, "org"),
          eq(userRoles.scopeId, organizationId)
        )
      );

    if (existingRoles.length > 0) {
      return createdUser;
    }

    // 5) Assign the resolved role at org scope for new user only
    try {
      await db.insert(userRoles).values({
        id: randomUUID(),
        userId: createdUser.id,
        tenantId: tenantId,
        provider: provider,
        roleId: resolvedRoleId,
        scopeType: "org",
        scopeId: organizationId,
        createdBy: null,
      });
    } catch (insertErr: any) {
      if (insertErr?.errno === MYSQL_ER_DUP_ENTRY || insertErr?.code === "ER_DUP_ENTRY") {
        return createdUser;
      }
      throw insertErr;
    }
  } catch (err) {
    console.error(
      "[UserBootstrap] Role/organization assignment failed, continuing without role:",
      err,
    );
  }

  return createdUser;
}

/**
 * Extract user information from Azure AD token claims
 * This function should be called with the decoded token claims
 */
export function extractAzureUserInfo(tokenClaims: any): SSOUserInfo {
  return {
    azureOid: tokenClaims.oid || tokenClaims.sub, // Object ID or Subject
    email: tokenClaims.email || tokenClaims.preferred_username || tokenClaims.upn,
    displayName: tokenClaims.name || tokenClaims.given_name + " " + tokenClaims.family_name || tokenClaims.preferred_username,
    tenantId: tokenClaims.tid, // Tenant ID
    provider: "microsoft",
  };
}

/**
 * Extract user information from GitHub OAuth token
 * This function should be called with the GitHub user API response
 */
export function extractGitHubUserInfo(githubUser: any, githubToken?: string): SSOUserInfo {
  return {
    githubId: githubUser.id?.toString(),
    email: githubUser.email || githubUser.login + "@github.local",
    displayName: githubUser.name || githubUser.login,
    provider: "github",
  };
}

/**
 * Align legacy user_roles.provider values (e.g. "azure") with the current auth provider
 * so TenantAdmin rows are not invisible to provider-scoped checks after MSAL/Cognito migration.
 */
export async function syncLegacyRoleProviders(
  userId: string,
  tenantId: string,
  provider: string
): Promise<void> {
  if (provider === "github") return;

  const legacyProviders =
    provider === "microsoft" || provider === "cognito" ? (["azure"] as const) : [];

  for (const legacy of legacyProviders) {
    await db
      .update(userRoles)
      .set({ provider })
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
          eq(userRoles.provider, legacy)
        )
      );
  }
}

/**
 * Resolve the session user using the same identity key as bootstrapUser when possible.
 * Avoids email-only lookups that can attach the wrong user row or create duplicates.
 */
export async function resolveUserForSession(params: {
  email: string;
  providerUserId?: string;
  tenantIdFromHeader?: string;
  provider: string;
  userIdFromMiddleware?: string;
}): Promise<(typeof users.$inferSelect) | null> {
  if (params.userIdFromMiddleware) {
    const fromMiddleware = await db
      .select()
      .from(users)
      .where(eq(users.id, params.userIdFromMiddleware))
      .limit(1);
    if (fromMiddleware[0]) {
      return fromMiddleware[0];
    }
  }

  if (params.providerUserId) {
    const userInfo: SSOUserInfo = {
      email: params.email,
      azureOid:
        params.provider === "github" || params.provider === "keycloak"
          ? undefined
          : params.providerUserId,
      githubId: params.provider === "github" ? params.providerUserId : undefined,
      keycloakId:
        params.provider === "github" || params.provider === "microsoft" || params.provider === "cognito"
          ? undefined
          : params.providerUserId,
      tenantId: params.tenantIdFromHeader,
      provider: params.provider,
    };
    return bootstrapUser(userInfo, params.tenantIdFromHeader);
  }

  // Email-only fallback — never create a new user here (bootstrapUser owns creation + roles).
  const byEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, params.email))
    .limit(1);
  return byEmail[0] ?? null;
}

/**
 * Ensure a user has an OrgAdmin role when they have none (legacy / email-only rows).
 * Never assigns Viewer — that is an explicit admin-assigned role only.
 */
export async function ensureViewerRole(
  userId: string,
  tenantId: string,
  provider: string
): Promise<boolean> {
  try {
    await syncLegacyRoleProviders(userId, tenantId, provider);

    const existingRolesInTenant = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)))
      .limit(1);

    if (existingRolesInTenant.length > 0) {
      return false;
    }

    // Step 2: Resolve or create organization for this tenant
    let organizationId: string | null = null;

    const orgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.tenantId, tenantId))
      .limit(1);

    if (orgs.length > 0) {
      organizationId = orgs[0].id;
    } else {
      const newOrgId = randomUUID();
      await db.insert(organizations).values({
        id: newOrgId,
        tenantId: tenantId,
        name: `Organization ${tenantId}`,
      });
      organizationId = newOrgId;
    }

    if (!organizationId) {
      console.warn("[EnsureDefaultRole] Could not resolve or create organization:", {
        userId,
        tenantId,
      });
      return false;
    }

    const roleIdToAssign = await resolveOrgAdminRoleId();

    const roleToAssign = roleIdToAssign
      ? (await db.select().from(roles).where(eq(roles.id, roleIdToAssign)).limit(1))[0]
      : null;

    if (!roleToAssign) {
      console.warn("[EnsureDefaultRole] Role not found:", { userId, roleId: roleIdToAssign });
      return false;
    }
    const resolvedRoleId = roleToAssign.id;

    const roleAlreadyExists = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, resolvedRoleId),
          eq(userRoles.scopeType, "org"),
          eq(userRoles.scopeId, organizationId),
          eq(userRoles.tenantId, tenantId),
          eq(userRoles.provider, provider)
        )
      )
      .limit(1);

    if (roleAlreadyExists.length > 0) {
      return false;
    }

    try {
      await db.insert(userRoles).values({
        id: randomUUID(),
        userId,
        tenantId,
        provider,
        roleId: resolvedRoleId,
        scopeType: "org",
        scopeId: organizationId,
        createdBy: null,
      });

      console.log("[EnsureDefaultRole] Auto-assigned role to user without roles:", {
        userId,
        tenantId,
        provider,
        organizationId,
        roleId: resolvedRoleId,
        roleName: roleToAssign.name,
      });

      return true;
    } catch (insertErr: any) {
      // Handle race condition: if duplicate insert occurs, that's fine
      if (insertErr?.errno === MYSQL_ER_DUP_ENTRY || insertErr?.code === "ER_DUP_ENTRY") {
        console.log("[EnsureDefaultRole] Duplicate insert (race condition handled):", { userId });
        return false;
      }
      throw insertErr;
    }
  } catch (err) {
    console.error("[EnsureDefaultRole] Failed to ensure default role:", {
      userId,
      tenantId,
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - this is best-effort. Allow login to continue even if role assignment fails.
    return false;
  }
}
