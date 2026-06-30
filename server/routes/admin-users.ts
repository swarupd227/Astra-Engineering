import type { Express, Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { users, userRoles, roles, projectMembers } from "@shared/schema";
import { db } from "../db";
import { requireRole } from "../auth/middleware";

type TenantContextResolver = (userId: string) => Promise<{
  tenantId: string;
  provider: string;
}>;

export function registerAdminUsersRoutes(
  app: Express,
  getOrgAdminTenantContext: TenantContextResolver,
) {
  // Fetch users and roles for the current tenant with pagination at user level.
  app.get(
    "/api/admin/users",
    requireRole(["TenantAdmin"]),
    async (req: any, res: Response) => {
      try {
        const authUser = req.user;
        if (!authUser?.id) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const { tenantId } = await getOrgAdminTenantContext(authUser.id);
        const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
        const parsedLimit = Number.parseInt(String(req.query.limit ?? "10"), 10);
        const search = String(req.query.search ?? "").trim();
        const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limit =
          Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(parsedLimit, 100)
            : 10;
        const offset = (page - 1) * limit;
        const hasSearch = search.length > 0;
        const searchPattern = `%${search.toLowerCase()}%`;
        const searchCondition = hasSearch
          ? sql<boolean>`
              (
                lower(coalesce(${users.displayName}, '')) like ${searchPattern}
                or lower(${users.email}) like ${searchPattern}
              )
            `
          : undefined;

        const totalRows = hasSearch
          ? await db
              .select({
                total: sql<number>`count(distinct ${users.id})`,
              })
              .from(users)
              .where(and(eq(users.tenantId, tenantId), searchCondition))
          : await db
              .select({
                total: sql<number>`count(distinct ${users.id})`,
              })
              .from(users)
              .where(eq(users.tenantId, tenantId));
        const total = Number(totalRows[0]?.total ?? 0);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        const pagedUsers = hasSearch
          ? await db
              .select({
                userId: users.id,
                displayName: users.displayName,
                email: users.email,
              })
              .from(users)
              .where(and(eq(users.tenantId, tenantId), searchCondition))
              .orderBy(asc(users.displayName), asc(users.email), asc(users.id))
              .limit(limit)
              .offset(offset)
          : await db
              .select({
                userId: users.id,
                displayName: users.displayName,
                email: users.email,
              })
              .from(users)
              .where(eq(users.tenantId, tenantId))
              .orderBy(asc(users.displayName), asc(users.email), asc(users.id))
              .limit(limit)
              .offset(offset);

        if (pagedUsers.length === 0) {
          return res.json({
            items: [],
            page,
            limit,
            total,
            totalPages,
          });
        }

        const pagedUserIds = pagedUsers.map((u) => u.userId);
        const roleRows = await db
          .select({
            userId: userRoles.userId,
            userRoleId: userRoles.id,
            role: roles.name,
            scope: userRoles.scopeType,
            projectId: userRoles.scopeType,
            scopeId: userRoles.scopeId,
          })
          .from(userRoles)
          .leftJoin(roles, eq(userRoles.roleId, roles.id))
          .where(
            and(
              inArray(userRoles.userId, pagedUserIds),
              eq(userRoles.tenantId, tenantId),
            ),
          );
        const memberRows = await db
          .select({
            userId: projectMembers.userId,
            projectId: projectMembers.projectId,
          })
          .from(projectMembers)
          .where(
            and(
              inArray(projectMembers.userId, pagedUserIds),
              eq(projectMembers.tenantId, tenantId),
            ),
          );

        // Keep output shape and user-role transformation exactly aligned with existing behavior.
        const userMap = new Map<
          string,
          {
            userId: string;
            displayName: string | null;
            email: string;
            projectIds: string[];
            roles: Array<{
              userRoleId: string;
              role: string;
              scope: "org" | "project";
              scopeId: string | null;
              projectId: string | null;
            }>;
          }
        >();

        for (const user of pagedUsers) {
          if (!user.userId || !user.email) continue;
          userMap.set(user.userId, {
            userId: user.userId,
            displayName: user.displayName ?? user.email,
            email: user.email,
            projectIds: [],
            roles: [],
          });
        }

        for (const row of roleRows) {
          if (!row.userId) continue;
          const existing = userMap.get(row.userId);
          if (!existing) continue;

          if (row.userRoleId && row.role && row.scope) {
            existing.roles.push({
              userRoleId: row.userRoleId,
              role: row.role,
              scope: row.scope as "org" | "project",
              scopeId: row.scopeId ?? null,
              projectId: row.scope === "project" ? row.scopeId ?? null : null,
            });
          }
        }

        for (const member of memberRows) {
          if (!member.userId || !member.projectId) continue;
          const existing = userMap.get(member.userId);
          if (!existing) continue;
          if (!existing.projectIds.includes(member.projectId)) {
            existing.projectIds.push(member.projectId);
          }
        }

        const result = pagedUsers
          .map((u) => userMap.get(u.userId))
          .filter((u): u is NonNullable<typeof u> => Boolean(u))
          .map((user) => {
            if (user.roles.length === 0) {
              user.roles.push({
                userRoleId: "default-viewer",
                role: "Viewer",
                scope: "org" as const,
                scopeId: null,
                projectId: null,
              });
            }
            return user;
          });

        res.json({
          items: result,
          page,
          limit,
          total,
          totalPages,
        });
      } catch (error: any) {
        console.error("[Admin] Error fetching tenant users:", error);
        res.status(500).json({
          error: "Failed to fetch users",
          message: error.message,
        });
      }
    },
  );
}
