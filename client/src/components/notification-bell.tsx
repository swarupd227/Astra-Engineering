import { useEffect, useCallback, useState, useMemo } from "react";
import { Bell, Filter, X, Building2, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiUrl, SOCKET_BASE_URL } from "@/lib/api-config";
import { io, Socket } from "socket.io-client";
import { format, formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { addUserInfoToRequest } from "@/utils/api-interceptor";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  brdTitle?: string | null;
  authorName?: string | null;
  brdId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  organizationName?: string | null;
  isRead: boolean;
  createdAt: string;
}

function getNotificationSummary(notification: NotificationItem) {
  if (notification.type === "BRD_APPROVED") {
    return notification.message || "This BRD has been approved.";
  }

  if (notification.type === "BRD_REVIEW_INITIATED") {
    return notification.message || "You sent this BRD for review.";
  }

  return notification.message || "This BRD is waiting for review.";
}

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_BASE_URL, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

export function NotificationBell({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterOrg, setFilterOrg] = useState("");
  const [filterProject, setFilterProject] = useState("");

  // Always-on query for badge count only
  const { data: countData } = useQuery({
    queryKey: ["/api/notifications", "count"],
    queryFn: async () => {
      const url = getApiUrl("/api/notifications");
      const options = await addUserInfoToRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) return { unreadCount: 0 };
      const json = await res.json() as { notifications: NotificationItem[]; unreadCount: number };
      return { unreadCount: json.unreadCount };
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Lazy query — only fetches when the popover is open
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ["/api/notifications", "list"],
    queryFn: async () => {
      const url = getApiUrl("/api/notifications");
      const options = await addUserInfoToRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) return { notifications: [], unreadCount: 0 };
      return res.json() as Promise<{ notifications: NotificationItem[]; unreadCount: number }>;
    },
    enabled: Boolean(userId) && open,
    staleTime: 30 * 1000,
  });

  const notifications = listData?.notifications ?? [];
  const unreadCount = countData?.unreadCount ?? 0;

  const orgs = useMemo(() => {
    const seen = new Set<string>();
    return notifications
      .map((n) => n.organizationName)
      .filter((o): o is string => !!o && !seen.has(o) && !!seen.add(o));
  }, [notifications]);

  const projects = useMemo(() => {
    const seen = new Set<string>();
    return notifications
      .filter((n) => !filterOrg || n.organizationName === filterOrg)
      .map((n) => n.projectName)
      .filter((p): p is string => !!p && !seen.has(p) && !!seen.add(p));
  }, [notifications, filterOrg]);

  const handleOrgChange = useCallback((val: string) => {
    setFilterOrg(val);
    setFilterProject("");
  }, []);

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filterOrg && n.organizationName !== filterOrg) return false;
      if (filterProject && n.projectName !== filterProject) return false;
      return true;
    });
  }, [notifications, filterOrg, filterProject]);

  const hasActiveFilter = !!(filterOrg || filterProject);

  const getNotificationBadge = useCallback((type: string) => {
    if (type === "BRD_APPROVED") {
      return {
        label: "Approved",
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
      };
    }

    if (type === "BRD_REVIEW_INITIATED") {
      return {
        label: "Sent",
        className:
          "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
      };
    }

    return {
      label: "Pending",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const s = getSocket();
    s.emit("join-user", userId);
    const handleNew = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "list"] });
    };
    s.on("notification:new", handleNew);
    return () => {
      s.off("notification:new", handleNew);
      s.emit("leave-user", userId);
    };
  }, [userId, queryClient]);

  const markRead = useCallback(async (id: string) => {
    if (!userId) return;
    const url = getApiUrl(`/api/notifications/${id}/read`);
    const options = await addUserInfoToRequest(url, { method: "PATCH", credentials: "include" });
    await fetch(url, options);
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "list"] });
  }, [queryClient, userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const url = getApiUrl("/api/notifications/read-all");
    const options = await addUserInfoToRequest(url, { method: "PATCH", credentials: "include" });
    await fetch(url, options);
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "list"] });
  }, [queryClient, userId]);

  const handleClick = useCallback(async (n: NotificationItem) => {
    if (!n.isRead) await markRead(n.id);
    if (n.brdId && n.projectId) {
      setOpen(false);
      const params = new URLSearchParams();
      params.set("projectId", n.projectId);
      if (n.projectName) params.set("projectName", n.projectName);
      params.set("brdId", n.brdId);
      setLocation(`/brd?${params.toString()}`);
    }
  }, [markRead, setLocation]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="notification-bell">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[500px] p-0 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-900/40 dark:text-red-400">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!listLoading && notifications.length > 0 && (
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={`relative rounded-md p-1.5 transition-colors hover:bg-muted ${showFilters || hasActiveFilter ? "text-blue-500 bg-blue-50 dark:bg-blue-950/30" : "text-muted-foreground"}`}
                title="Filter notifications"
              >
                <Filter className="h-3.5 w-3.5" />
                {hasActiveFilter && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </button>
            )}
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && !listLoading && notifications.length > 0 && (
          <div className="border-b bg-muted/30 px-4 py-3 space-y-2">
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3 w-3" /> Organization
              </label>
              <select
                value={filterOrg}
                onChange={(e) => handleOrgChange(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">All organizations</option>
                {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <FolderKanban className="h-3 w-3" /> Project
              </label>
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">All projects</option>
                {projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {hasActiveFilter && (
              <button
                onClick={() => { setFilterOrg(""); setFilterProject(""); }}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
              >
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* List */}
        <ScrollArea className="h-80">
          {listLoading ? (
            <div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 border-b px-4 py-3.5 animate-pulse">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-4/5 rounded bg-muted" />
                    <div className="h-2.5 w-16 rounded bg-muted" />
                    <div className="h-2 w-2/3 rounded bg-muted" />
                    <div className="h-2 w-1/3 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Bell className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilter ? "No notifications match filters" : "No notifications"}
              </p>
            </div>
          ) : (
            filtered.map((n) => (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                className={`group relative cursor-pointer border-b px-4 py-3.5 transition-colors hover:bg-muted/50 ${!n.isRead ? "bg-blue-50/40 dark:bg-blue-950/15" : ""}`}
              >
                {/* Unread indicator */}
                {!n.isRead && (
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}

                <div className="space-y-2 pl-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug truncate">
                        {n.brdTitle || n.title || "Untitled BRD"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {getNotificationSummary(n)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 mt-0.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getNotificationBadge(n.type).className}`}
                    >
                      {getNotificationBadge(n.type).label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {n.authorName && (
                      <span className="rounded-md bg-muted px-2 py-1">
                        Sender: {n.authorName}
                      </span>
                    )}
                    {n.projectName && (
                      <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                        <FolderKanban className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px]">{n.projectName}</span>
                      </span>
                    )}
                    {n.organizationName && (
                      <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px]">{n.organizationName}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground/70">
                    {format(new Date(n.createdAt), "dd MMM yyyy, h:mm a")}
                    {" | "}
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
