import type { Express, Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";
import { sdlcProjects, users, notifications } from "@shared/schema";
import { extractAdoOrgName } from "./ado-utils";
import { requireAuth } from "./auth/middleware";

export function registerNotificationRoutes(app: Express) {
  // GET /api/notifications — list BRD notification history for the current user.
  // Ordered by newest (createdAt desc). Read state tracked via notifications table.
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any)?.user?.id as string | undefined;
      if (!userId) return res.json({ notifications: [], unreadCount: 0 });

      const [userRecord] = await db
        .select({ id: users.id, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!userRecord?.tenantId) return res.json({ notifications: [], unreadCount: 0 });

      const creatorUsers = users;
      const assignedNotifications = await db
        .select({
          id: notifications.id,
          type: notifications.type,
          brdId: notifications.brdId,
          projectId: notifications.projectId,
          title: notifications.title,
          message: notifications.message,
          isRead: notifications.isRead,
          createdAt: notifications.createdAt,
          brdTitle: schema.devBrdDocuments.title,
          brdStatus: schema.devBrdDocuments.status,
          projectName: sdlcProjects.name,
          organizationName: sdlcProjects.organization,
          authorName: creatorUsers.displayName,
        })
        .from(notifications)
        .leftJoin(schema.devBrdDocuments, eq(notifications.brdId, schema.devBrdDocuments.id))
        .leftJoin(sdlcProjects, eq(notifications.projectId, sdlcProjects.projectId))
        .leftJoin(creatorUsers, eq(schema.devBrdDocuments.createdBy, creatorUsers.id))
        .where(eq(notifications.userId, userRecord.id))
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      const latestByBrd = new Map<string, (typeof assignedNotifications)[number] & { hasUnread: boolean }>();

      for (const notification of assignedNotifications) {
        const groupKey = notification.brdId || notification.id;
        const existing = latestByBrd.get(groupKey);

        if (!existing) {
          latestByBrd.set(groupKey, {
            ...notification,
            hasUnread: !notification.isRead,
          });
          continue;
        }

        if (!notification.isRead) {
          existing.hasUnread = true;
        }
      }

      const result = Array.from(latestByBrd.values()).map((notification) => {
        const effectiveType =
          notification.brdStatus === "approved"
            ? "BRD_APPROVED"
            : notification.type;
        const effectiveTitle =
          notification.brdTitle ||
          notification.title ||
          (effectiveType === "BRD_APPROVED"
            ? "BRD approved"
            : effectiveType === "BRD_REVIEW_INITIATED"
              ? "BRD review initiated"
              : effectiveType === "BRD_REVIEW_REQUESTED"
                ? "BRD review requested"
                : "BRD notification");
        const effectiveMessage =
          notification.brdStatus === "approved" &&
          notification.type !== "BRD_APPROVED"
            ? notification.authorName
              ? `"${notification.brdTitle || "This BRD"}" has been approved. Sent by ${notification.authorName}.`
              : `"${notification.brdTitle || "This BRD"}" has been approved.`
            : (notification.message || "");

        return {
          id: notification.id,
          type: effectiveType,
          title: effectiveTitle,
          message: effectiveMessage,
          brdTitle: notification.brdTitle,
          authorName: notification.authorName ?? null,
          brdId: notification.brdId,
          projectId: notification.projectId,
          projectName: notification.projectName,
          organizationName: extractAdoOrgName(notification.organizationName),
          isRead: !notification.hasUnread,
          createdAt: notification.createdAt?.toISOString?.() ?? new Date().toISOString(),
        };
      });

      const unreadCount = result.filter(n => !n.isRead).length;
      return res.json({ notifications: result, unreadCount });
    } catch (err) {
      console.error("[Notifications] GET error:", err);
      return res.json({ notifications: [], unreadCount: 0 });
    }
  });

  // PATCH /api/notifications/:brdId/read — mark a BRD notification as read (upsert by brdId)
  app.patch("/api/notifications/:notificationId/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const { notificationId } = req.params;
      const userId = (req as any)?.user?.id as string | undefined;
      if (!userId) return res.json({ success: true });

      const [userRecord] = await db
        .select({ id: users.id })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!userRecord) return res.json({ success: true });

      const [targetNotification] = await db
        .select({ id: notifications.id, brdId: notifications.brdId })
        .from(notifications)
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, userRecord.id)
          )
        )
        .limit(1);

      if (!targetNotification) {
        return res.json({ success: true });
      }

      if (targetNotification.brdId) {
        await db.update(notifications).set({ isRead: true }).where(
          and(
            eq(notifications.userId, userRecord.id),
            eq(notifications.brdId, targetNotification.brdId)
          )
        );
      } else {
        await db.update(notifications).set({ isRead: true }).where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, userRecord.id)
          )
        );
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Notifications] PATCH read error:", err);
      return res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // PATCH /api/notifications/read-all — mark all current review BRDs as read for current user
  app.patch("/api/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any)?.user?.id as string | undefined;
      if (!userId) return res.json({ success: true });

      const [userRecord] = await db
        .select({ id: users.id, tenantId: users.tenantId })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!userRecord?.tenantId) return res.json({ success: true });

      // Mark all unread notifications for this user as read
      await db.update(notifications).set({ isRead: true }).where(
        and(
          eq(notifications.userId, userRecord.id),
          eq(notifications.isRead, false)
        )
      );

      return res.json({ success: true });
    } catch (err) {
      console.error("[Notifications] PATCH read-all error:", err);
      return res.status(500).json({ error: "Failed to mark all as read" });
    }
  });
}
