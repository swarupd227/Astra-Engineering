import type { Express, Request, Response } from "express";
import { eq, and, inArray, not, desc } from "drizzle-orm";
import type { Server as SocketIOServer } from "socket.io";
import { db } from "./db";
import * as schema from "@shared/schema";
import { users, roles, userRoles, roleActivityPermissions, notifications } from "@shared/schema";
import { hasActivityEnabled, requireAuth } from "./auth/middleware";

export function registerBrdStatusRoutes(
  app: Express,
  getIo: () => InstanceType<typeof SocketIOServer> | null,
) {
  const SUPPORTED_PROVIDERS = ["microsoft", "azure", "cognito", "keycloak"] as const;

  const getActorContext = async (userId: string) => {
    const [actor] = await db
      .select({
        tenantId: users.tenantId,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const actorName = actor?.displayName || actor?.email || "";

    return {
      tenantId: actor?.tenantId ?? null,
      actorName,
    };
  };

  const canUserAutoApproveBrd = async (userId: string, tenantId: string) => {
    const [eligibleRole] = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
          inArray(userRoles.provider, [...SUPPORTED_PROVIDERS]),
          inArray(roles.name, ["TenantAdmin", "OrgAdmin", "BusinessAnalyst", "BA"])
        )
      )
      .limit(1);

    if (!eligibleRole) {
      return false;
    }

    return hasActivityEnabled(userId, "SDLC_BRD_APPROVAL");
  };

  const upsertBrdNotification = async (params: {
    tenantId: string;
    userId: string;
    brdId: string;
    projectId: string | null;
    type: "BRD_REVIEW_REQUESTED" | "BRD_REVIEW_INITIATED" | "BRD_APPROVED";
    title: string;
    message: string;
  }) => {
    const [existingNotification] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, params.userId),
          eq(notifications.brdId, params.brdId)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);

    if (existingNotification) {
      await db
        .update(notifications)
        .set({
          type: params.type,
          title: params.title,
          message: params.message,
          projectId: params.projectId,
          isRead: false,
          createdAt: new Date(),
        })
        .where(eq(notifications.id, existingNotification.id));

      return { id: existingNotification.id, ...params, isRead: false };
    }

    const [insertedNotification] = await db
      .insert(notifications)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        brdId: params.brdId,
        projectId: params.projectId,
        isRead: false,
      })
      .$returningId();

    return { id: insertedNotification?.id, ...params, isRead: false };
  };

  /**
   * Return eligible approvers for an activity in the current user's tenant.
   * - Titles = `roles.name` derived from `role_activity_permissions`
   * - Users grouped by those titles, based on `user_roles`
   *
   * Used by BRD UI dropdowns so approver lists don't need hardcoding.
   */
  app.get(
    "/api/user/approvers/:activityKey",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { activityKey } = req.params;
        if (!activityKey) {
          return res.status(400).json({ error: "activityKey is required" });
        }

        const authedUserId = (req as any)?.user?.id as string | undefined;
        if (!authedUserId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const [me] = await db
          .select({ tenantId: users.tenantId, provider: users.provider })
          .from(users)
          .where(eq(users.id, authedUserId))
          .limit(1);

        const tenantId = me?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: "Tenant not found for user" });
        }

        // Fetch explicit activity permissions for this tenant and activity.
        // Roles are allowed by default unless explicitly disabled in role_activity_permissions.
        const roleWhereConds = [
          eq(roleActivityPermissions.activityKey, activityKey),
          inArray(roleActivityPermissions.provider, [...SUPPORTED_PROVIDERS]),
        ];

        const activityRoleRows = await db
          .select({
            roleId: roleActivityPermissions.roleId,
            roleName: roles.name,
            enabled: roleActivityPermissions.enabled,
          })
          .from(roleActivityPermissions)
          .innerJoin(roles, eq(roleActivityPermissions.roleId, roles.id))
          .where(and(...roleWhereConds));

        const disabledRoleIds = new Set(
          activityRoleRows
            .filter((r) => r.enabled === false)
            .map((r) => r.roleId)
        );

        // All user roles for this tenant, with implicit approval unless explicitly disabled.
        const userRoleWhereConds = [
          eq(userRoles.tenantId, tenantId),
          inArray(userRoles.provider, [...SUPPORTED_PROVIDERS]),
        ];

        const userRoleRows = await db
          .select({
            userId: userRoles.userId,
            roleId: userRoles.roleId,
            roleName: roles.name,
            displayName: users.displayName,
            email: users.email,
          })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .innerJoin(users, eq(userRoles.userId, users.id))
          .where(and(...userRoleWhereConds));

        const usersByRoleName: Record<
          string,
          Array<{ userId: string; name: string }>
        > = {};
        const addedUserRoleKeys = new Set<string>();

        for (const row of userRoleRows) {
          if (row.userId === authedUserId) {
            continue;
          }

          if (disabledRoleIds.has(row.roleId)) {
            continue;
          }

          const roleName = row.roleName;
          const name = row.displayName || row.email || row.userId;
          const key = `${row.userId}::${row.roleId}`;
          if (addedUserRoleKeys.has(key)) {
            continue;
          }
          addedUserRoleKeys.add(key);

          if (!usersByRoleName[roleName]) {
            usersByRoleName[roleName] = [];
          }
          usersByRoleName[roleName].push({ userId: row.userId, name });
        }

        const roleNameToRoleId = new Map<string, number>();
        for (const row of userRoleRows) {
          if (!roleNameToRoleId.has(row.roleName)) roleNameToRoleId.set(row.roleName, row.roleId);
        }

        const rolesResult = Object.keys(usersByRoleName)
          .map((roleName) => ({
            roleId: roleNameToRoleId.get(roleName) ?? -1,
            roleName,
          }))
          .sort((a, b) => a.roleName.localeCompare(b.roleName));

        for (const roleName of Object.keys(usersByRoleName)) {
          usersByRoleName[roleName].sort((a, b) => a.name.localeCompare(b.name));
        }

        return res.json({ roles: rolesResult, usersByRoleName });
      } catch (error) {
        console.error("[Routes][BRD Approvers] Failed:", error);
        return res.status(500).json({ error: "Failed to fetch approvers" });
      }
    }
  );

  app.get(
    "/api/dev-brd/:id/can-approve",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const brdId = req.params.id;
        const authedUserId = (req as any)?.user?.id as string | undefined;
        if (!authedUserId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const [brd] = await db
          .select({ status: schema.devBrdDocuments.status })
          .from(schema.devBrdDocuments)
          .where(eq(schema.devBrdDocuments.id, brdId))
          .limit(1);

        if (!brd || brd.status !== "review") {
          return res.json({ allowed: false });
        }

        const canApprove = await hasActivityEnabled(authedUserId, "SDLC_BRD_APPROVAL");
        if (!canApprove) {
          return res.json({ allowed: false });
        }

        const [matchingNotification] = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, authedUserId),
              eq(notifications.brdId, brdId),
              eq(notifications.type, "BRD_REVIEW_REQUESTED")
            )
          )
          .limit(1);

        return res.json({ allowed: Boolean(matchingNotification) });
      } catch (error) {
        console.error("[Routes][BRD Can Approve] Failed:", error);
        return res.status(500).json({ error: "Failed to check BRD approval access" });
      }
    }
  );

  app.put(
    "/api/dev-brd/:id/status",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const brdId = req.params.id;
        const { status, reviewerIds, autoApprove } = req.body as {
          status?: string;
          reviewerIds?: string[];
          autoApprove?: boolean;
        };

        if (!status) {
          return res.status(400).json({ error: "status is required" });
        }

        const validStatuses = ["draft", "review", "approved", "pending_review", "rejected"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({
            error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          });
        }

        const authedUserId = (req as any)?.user?.id as string | undefined;
        if (!authedUserId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        // Fetch current BRD record before updating status
        const [existing] = await db
          .select()
          .from(schema.devBrdDocuments)
          .where(eq(schema.devBrdDocuments.id, brdId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ error: "BRD not found" });
        }

        if (status === "approved") {
          const canApprove = await hasActivityEnabled(authedUserId, "SDLC_BRD_APPROVAL");
          if (!canApprove) {
            return res.status(403).json({
              error: "Forbidden",
              message: 'Activity "SDLC_BRD_APPROVAL" is not enabled for your role(s). Contact your administrator.',
            });
          }

          const [assignedNotification] = await db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, authedUserId),
                eq(notifications.brdId, brdId),
                eq(notifications.type, "BRD_REVIEW_REQUESTED")
              )
            )
            .limit(1);

          if (!assignedNotification) {
            return res.status(403).json({
              error: "Forbidden",
              message: "Only selected reviewers can approve this BRD.",
            });
          }
        }

        if (status === "approved" && existing.status !== "review") {
          return res.status(400).json({
            error: "Invalid status transition",
            message: "Only BRDs currently in review can be approved.",
          });
        }

        const { tenantId, actorName: authorName } = await getActorContext(authedUserId);

        if (status === "review" && autoApprove) {
          if (!tenantId) {
            return res.status(400).json({ error: "Tenant not found for user" });
          }

          const canAutoApprove = await canUserAutoApproveBrd(authedUserId, tenantId);
          if (!canAutoApprove) {
            return res.status(403).json({
              error: "Forbidden",
              message: "Only Tenant Admin, Org Admin, or Business Analyst users can enable auto approve.",
            });
          }
        }

        // Update the BRD status.
        // IMPORTANT: Requirement extraction happens during BRD generation (POST /api/brd/generate),
        // NOT during approval. This endpoint only updates the status field.
        await db
          .update(schema.devBrdDocuments)
          .set({ status, updatedAt: new Date() })
          .where(eq(schema.devBrdDocuments.id, brdId));

        // Quality: BRD approved (after review) → mark its AI generation accepted.
        // Linked by correlationId = brdId (set at generation), so the right row is
        // marked regardless of which reviewer approves.
        if (status === "approved") {
          try {
            const { markAccepted } = await import("./observability/quality");
            // Precise link by brdId (stamped at generation); fall back to the BRD
            // creator's latest unrated 'brd' row for BRDs generated before linking.
            markAccepted({ correlationId: brdId, userId: existing.createdBy || undefined, feature: "brd" });
          } catch { /* non-fatal */ }
        }

        const [updated] = await db
          .select({
            id: schema.devBrdDocuments.id,
            projectId: schema.devBrdDocuments.projectId,
            title: schema.devBrdDocuments.title,
            status: schema.devBrdDocuments.status,
            updatedAt: schema.devBrdDocuments.updatedAt,
          })
          .from(schema.devBrdDocuments)
          .where(eq(schema.devBrdDocuments.id, brdId))
          .limit(1);

        // Send notifications to approver users when BRD is sent for review
        if (status === "review" && existing.projectId) {
          try {
            if (!existing.createdBy || existing.createdBy === "system") {
              await db
                .update(schema.devBrdDocuments)
                .set({ createdBy: authedUserId, updatedAt: new Date() })
                .where(eq(schema.devBrdDocuments.id, brdId));

              existing.createdBy = authedUserId;
            }

            const selectedReviewerIds = Array.isArray(reviewerIds)
              ? reviewerIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              : null;

            if (tenantId) {
              // Find all roles in this tenant that currently have SDLC_BRD_APPROVAL enabled.
              const rolePermWhereConds = [
                eq(roleActivityPermissions.activityKey, "SDLC_BRD_APPROVAL"),
                eq(roleActivityPermissions.tenantId, tenantId),
                inArray(roleActivityPermissions.provider, [...SUPPORTED_PROVIDERS]),
              ];

              const rolePermRows = await db
                .select({
                  roleId: roleActivityPermissions.roleId,
                  enabled: roleActivityPermissions.enabled,
                })
                .from(roleActivityPermissions)
                .where(and(...rolePermWhereConds));

              const disabledRoleIds = new Set(
                rolePermRows
                  .filter((r) => r.enabled === false)
                  .map((r) => r.roleId)
              );

              // Find all users in this tenant who have at least one approver role that is not explicitly disabled.
              const approverUserWhereConds = [
                eq(userRoles.tenantId, tenantId),
                inArray(userRoles.provider, [...SUPPORTED_PROVIDERS]),
              ];
              if (disabledRoleIds.size > 0) {
                approverUserWhereConds.push(not(inArray(userRoles.roleId, [...disabledRoleIds])));
              }

              const approverUsers = await db
                .select({
                  userId: userRoles.userId,
                  name: users.displayName,
                  email: users.email,
                })
                .from(userRoles)
                .innerJoin(users, eq(userRoles.userId, users.id))
                .where(and(...approverUserWhereConds));

              const reviewerIdSet = selectedReviewerIds
                ? new Set(selectedReviewerIds)
                : new Set(approverUsers.map((u) => u.userId));

              if (autoApprove) {
                reviewerIdSet.add(authedUserId);
              }

              const targetApproverUsers = approverUsers.filter((u) => reviewerIdSet.has(u.userId));

              // When auto-approve is enabled, also ensure current user gets BRD_REVIEW_REQUESTED notification
              // even if they're not in the approverUsers list
              const notifRecipients = [...targetApproverUsers];
              console.log(
                `[Routes][Send to Review] autoApprove=${autoApprove}, authedUserId=${authedUserId}, targetApproverUsers=${targetApproverUsers.map((u) => u.userId).join(", ")}`
              );
              if (autoApprove && !notifRecipients.some((u) => u.userId === authedUserId)) {
                console.log(`[Routes][Send to Review] Adding current user ${authedUserId} to notifRecipients`);
                notifRecipients.push({
                  userId: authedUserId,
                  name: authorName || "",
                  email: "",
                });
              }
              console.log(
                `[Routes][Send to Review] Final notifRecipients: ${notifRecipients.map((u) => u.userId).join(", ")}`
              );

              const brdTitle = existing.title || "Untitled BRD";
              const notifRows = notifRecipients.map((u) => {
                return {
                  tenantId,
                  userId: u.userId,
                  type: "BRD_REVIEW_REQUESTED",
                  title: "BRD review requested",
                  message: authorName
                    ? `${authorName} sent "${brdTitle}" for your review.`
                    : `A BRD review was requested for "${brdTitle}".`,
                  brdId,
                  projectId: existing.projectId,
                };
              });

              const reviewerNames = notifRecipients
                .map((u) => u.name || u.email || u.userId)
                .filter((name, index, arr) => arr.indexOf(name) === index);

              notifRows.push({
                tenantId,
                userId: authedUserId,
                type: "BRD_REVIEW_INITIATED",
                title: "BRD review initiated",
                message:
                  reviewerNames.length > 0
                    ? `You sent "${brdTitle}" to ${reviewerNames.join(", ")} for review.`
                    : `You sent "${brdTitle}" for review.`,
                brdId,
                projectId: existing.projectId,
              });

              if (notifRows.length > 0) {
                console.log(
                  `[Routes][Send to Review] Inserting ${notifRows.length} notifications for BRD ${brdId}`
                );
                try {
                  await db.insert(notifications).values(notifRows);
                  console.log(
                    `[Routes][Send to Review] Successfully inserted notifications for users: ${notifRows.map((r) => r.userId).join(", ")}`
                  );
                } catch (err) {
                  console.error(`[Routes][Send to Review] Failed to insert notifications:`, err);
                  throw err;
                }

                const io = getIo();
                if (io) {
                  for (const row of notifRows) {
                    io.to(`user:${row.userId}`).emit("notification:new", {
                      type: row.type,
                      title: row.title,
                      message: row.message,
                      brdId,
                      projectId: existing.projectId,
                      createdAt: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          }
          catch (notifErr) {
            console.error("[Routes][Notifications] Failed to send notifications:", notifErr);
            // Non-fatal — don't fail the status update
          }
        }

        // When BRD is approved, notify the BRD creator and refresh reviewer notification lists.
        if (status === "approved") {
          const io = getIo();

          try {
            const { tenantId, actorName } = await getActorContext(authedUserId);

            if (tenantId) {
              const brdTitle = existing.title || "Untitled BRD";
              const senderContext = existing.createdBy
                ? await getActorContext(existing.createdBy)
                : { tenantId: null, actorName: "" };
              const senderName = senderContext.actorName || "Unknown sender";
              const approverName = actorName || "Unknown approver";
              const approvalRecipientIds = new Set<string>();

              if (existing.createdBy) {
                approvalRecipientIds.add(existing.createdBy);
              }

              const reviewParticipantRows = await db
                .select({ userId: notifications.userId })
                .from(notifications)
                .where(
                  and(
                    eq(notifications.brdId, brdId),
                    eq(notifications.type, "BRD_REVIEW_REQUESTED")
                  )
                );

              for (const row of reviewParticipantRows) {
                if (row.userId) {
                  approvalRecipientIds.add(row.userId);
                }
              }

              const approvalNotifications = Array.from(approvalRecipientIds).map((userId) => ({
                tenantId,
                userId,
                type: "BRD_APPROVED",
                title: "BRD approved",
                message: `${approverName} approved "${brdTitle}" sent by ${senderName}.`,
                brdId,
                projectId: existing.projectId,
              }));

              if (approvalNotifications.length > 0) {
                await db.insert(notifications).values(approvalNotifications);

                if (io) {
                  for (const approvalNotification of approvalNotifications) {
                    io.to(`user:${approvalNotification.userId}`).emit("notification:new", {
                      ...approvalNotification,
                      createdAt: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          } catch (notificationError) {
            console.error("[Routes][Notifications] Failed to create BRD approval notification:", notificationError);
          }

        }

        return res.json({ success: true, brd: updated });
      } catch (error) {
        console.error("[Routes][DEV-BRD] Error updating BRD status:", error);
        const message = error instanceof Error ? error.message : "Failed to update BRD status";
        return res.status(500).json({ error: "Failed to update BRD status", details: message });
      }
    }
  );
}
