import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { projectMembers, users } from "@shared/schema";

export interface EffectiveUserAccess {
  userId: string;
  userIds: string[];
  tenantIds: string[];
  primaryTenantId: string | null;
  email: string | null;
}

const normalizeEmail = (email: string | null | undefined) =>
  (email || "").trim().toLowerCase();

/**
 * Resolves all local user rows that represent the same verified human.
 *
 * The auth model intentionally stores provider identities separately, but
 * product access is person-centric. Until there is a dedicated account-linking
 * table, exact normalized email is the safest stable bridge across provider
 * rows created for the same person.
 */
export async function resolveEffectiveUserAccess(
  userId: string | null | undefined,
): Promise<EffectiveUserAccess | null> {
  if (!userId) return null;

  const [currentUser] = await db
    .select({
      id: users.id,
      email: users.email,
      tenantId: users.tenantId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!currentUser) {
    return {
      userId,
      userIds: [userId],
      tenantIds: [],
      primaryTenantId: null,
      email: null,
    };
  }

  const email = normalizeEmail(currentUser.email);
  const linkedUsers = email
    ? await db
        .select({
          id: users.id,
          tenantId: users.tenantId,
        })
        .from(users)
        .where(
          and(
            sql`LOWER(${users.email}) = ${email}`,
            eq(users.isDeleted, false),
          ),
        )
    : [{ id: currentUser.id, tenantId: currentUser.tenantId }];

  const userIds = Array.from(
    new Set([currentUser.id, ...linkedUsers.map((user) => user.id)]),
  );
  const tenantIds = Array.from(
    new Set(
      linkedUsers
        .map((user) => user.tenantId)
        .filter((tenantId): tenantId is string => Boolean(tenantId)),
    ),
  );

  return {
    userId,
    userIds,
    tenantIds,
    primaryTenantId: currentUser.tenantId ?? null,
    email: currentUser.email ?? null,
  };
}

export async function getEffectiveUserIds(userId: string | null | undefined) {
  const access = await resolveEffectiveUserAccess(userId);
  return access?.userIds ?? (userId ? [userId] : []);
}

export async function ensureProjectOwnerMembershipsForAliases(params: {
  projectId: string;
  ownerUserId: string | null | undefined;
  invitedBy?: string | null;
}) {
  const access = await resolveEffectiveUserAccess(params.ownerUserId);
  if (!access) return;

  for (const effectiveUserId of access.userIds) {
    const [user] = await db
      .select({ tenantId: users.tenantId })
      .from(users)
      .where(eq(users.id, effectiveUserId))
      .limit(1);
    const tenantId = user?.tenantId || access.primaryTenantId;
    if (!tenantId) continue;

    const [existing] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, params.projectId),
          eq(projectMembers.userId, effectiveUserId),
        ),
      )
      .limit(1);
    if (existing) continue;

    await db.insert(projectMembers).values({
      id: randomUUID(),
      projectId: params.projectId,
      userId: effectiveUserId,
      tenantId,
      role: effectiveUserId === params.ownerUserId ? "owner" : "member",
      invitedBy: params.invitedBy ?? params.ownerUserId ?? null,
    });
  }
}

export function hasEffectiveId(
  effectiveUserIds: Set<string>,
  candidate: string | null | undefined,
) {
  return Boolean(candidate && effectiveUserIds.has(candidate));
}

export function inArrayIfAny<TColumn>(column: TColumn, values: string[]) {
  return values.length > 0 ? inArray(column as any, values) : undefined;
}
