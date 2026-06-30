import { useCallback, useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, UserCog, X, Search, UserPlus, FileSpreadsheet, Upload, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { BulkUploadDialog } from "@/components/bulk-user-onboarding";
import { TableRowsSkeleton } from "@/components/ui/page-skeletons";
import { queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { useMsal } from "@azure/msal-react";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { addAuthToRequest } from "@/lib/auth-request";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Building2, FolderOpen } from "lucide-react";
import { useAdoAllowed, useJiraAllowed } from "@/hooks/use-hosting-config";

const SCOPE_ID_ALL = "ALL";

type AdminUserRole = {
  userRoleId: string;
  role: string;
  scope: "org" | "project";
  scopeId?: string | null;
  projectId: string | null;
};

type AdminUser = {
  userId: string;
  displayName: string | null;
  email: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
  projectIds?: string[];
  roles: AdminUserRole[];
};

type RoleRow = { id: number; name: string };
type PaginatedAdminUsersResponse = {
  items: AdminUser[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type MeRole = {
  role: string;
  scope: string;
  scopeId: string;
  tenantId: string;
  provider: string;
};

type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName?: string | null;
    provider?: string;
  };
  roles: MeRole[];
};

export default function AdminUserAccessPage() {
  const { toast } = useToast();
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const amplifyAuth = useAmplifyAuthOptional();
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();
  const keycloakAccount = isKeycloak ? getKeycloakAccount() : null;
  const authReady = isAmp
    ? !!amplifyAuth?.user
    : isKeycloak
      ? isKeycloakAuthenticated()
      : !!account;
  const authKey = isAmp
    ? amplifyAuth?.user?.sub ?? ""
    : isKeycloak
      ? keycloakAccount?.accountKey ?? ""
      : account?.localAccountId ?? "";
  const adoAllowed = useAdoAllowed();
  const jiraAllowed = useJiraAllowed();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  const [newUserRole, setNewUserRole] = useState("OrgAdmin");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [editingRole, setEditingRole] = useState<AdminUserRole | null>(null);
  const [role, setRole] = useState<string>("");
  const [scope, setScope] = useState<"org" | "project">("org");
  const [projectId, setProjectId] = useState<string>("");
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<
    string[]
  >([SCOPE_ID_ALL]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [roleToRemove, setRoleToRemove] = useState<AdminUserRole | null>(null);
  const [userToRemove, setUserToRemove] = useState<AdminUser | null>(null);

  const buildAuthRequest = async (url: string, options: RequestInit = {}) => {
    if (!authReady) {
      throw new Error("Not signed in");
    }

    return addAuthToRequest(url, options);
  };

  const buildAuthHeaders = useCallback(() => {
    const headers = new Headers();

    if (isKeycloak && keycloakAccount) {
      headers.set("x-auth-provider", keycloakAccount.provider || "keycloak");
      headers.set("x-user-email", keycloakAccount.email);
      headers.set("x-user-oid", keycloakAccount.subject);
      headers.set("x-user-name", keycloakAccount.displayName || keycloakAccount.email);
      return headers;
    }

    if (isAmp && amplifyAuth?.user) {
      headers.set("x-auth-provider", "cognito");
      if (amplifyAuth.user.email) headers.set("x-user-email", amplifyAuth.user.email);
      if (amplifyAuth.user.sub) headers.set("x-user-oid", amplifyAuth.user.sub);
      if (amplifyAuth.user.name || amplifyAuth.user.email) {
        headers.set("x-user-name", amplifyAuth.user.name || amplifyAuth.user.email || "");
      }
      return headers;
    }

    if (account) {
      const claims = account.idTokenClaims ?? {};
      const email =
        account.username ||
        (claims.email as string | undefined) ||
        (claims.preferred_username as string | undefined) ||
        "";
      const oid =
        (claims.oid as string | undefined) ||
        (claims.sub as string | undefined) ||
        account.localAccountId ||
        "";
      const tenantId = (claims.tid as string | undefined) || account.tenantId || "";
      const displayName = account.name || (claims.name as string | undefined) || email;

      headers.set("x-auth-provider", "microsoft");
      if (email) headers.set("x-user-email", email);
      if (oid) headers.set("x-user-oid", oid);
      if (tenantId) headers.set("x-tenant-id", tenantId);
      if (displayName) headers.set("x-user-name", displayName);
    }

    return headers;
  }, [account, amplifyAuth?.user, isAmp, isKeycloak, keycloakAccount]);

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const headers = buildAuthHeaders();
      const res = await fetch(getApiUrl("/api/admin/users/template"), {
        method: "GET",
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        throw new Error("Failed to download template");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "user-onboarding-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({
        title: "Download failed",
        description: e?.message ?? "Could not download the template",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const normalizedSearchTerm = searchTerm.trim();

  useEffect(() => {
    setPage(1);
  }, [normalizedSearchTerm]);

  const { data: usersResponse, isLoading } = useQuery<PaginatedAdminUsersResponse>({
    queryKey: [
      "/api/admin/users",
      authKey,
      page,
      limit,
      normalizedSearchTerm,
    ],
    enabled: authReady,
    queryFn: async () => {
      const searchQuery = normalizedSearchTerm
        ? `&search=${encodeURIComponent(normalizedSearchTerm)}`
        : "";
      const url = getApiUrl(`/api/admin/users?page=${page}&limit=${limit}${searchQuery}`);
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to load users",
        );
      }
      return res.json();
    },
  });
  const users = usersResponse?.items ?? [];
  const total = usersResponse?.total ?? 0;
  const totalPages = usersResponse?.totalPages ?? 1;

  const { data: rolesList = [] } = useQuery<RoleRow[]>({
    queryKey: ["/api/admin/roles", authKey],
    enabled: authReady,
    queryFn: async () => {
      const url = getApiUrl("/api/admin/roles");
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to load roles",
        );
      }
      return res.json();
    },
  });

  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ["/api/auth/me", authKey],
    enabled: authReady,
    queryFn: async () => {
      const url = getApiUrl("/api/auth/me");
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to load current user info",
        );
      }
      return res.json();
    },
  });

  type AdminOrg = { id: string; name: string };
  const organizationScope = scope === "project" ? "project" : "org";
  const { data: orgList = [] } = useQuery<AdminOrg[]>({
    queryKey: ["/api/admin/organizations", authKey, organizationScope],
    enabled: authReady && (isModalOpen || isNewUserModalOpen) && (adoAllowed || jiraAllowed),
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      const url = getApiUrl(`/api/admin/organizations?scope=${organizationScope}`);
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error("Failed to load organizations");
      }
      return res.json();
    },
  });

  type AdminProject = { id: string; name: string; organizationId: string };
  const { data: projectList = [] } = useQuery<AdminProject[]>({
    queryKey: ["/api/admin/projects", authKey],
    enabled: authReady && (isModalOpen || isNewUserModalOpen) && scope === "project" && (adoAllowed || jiraAllowed),
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      const url = getApiUrl("/api/admin/projects");
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to load projects",
        );
      }
      return res.json();
    },
  });

  const projectTree = useMemo(() => {
    return orgList.map((org) => ({
      org,
      projects: projectList.filter(
        (p) => p.organizationId === org.id,
      ),
    }));
  }, [orgList, projectList]);

  const parseScopeIds = (sid: string | null | undefined): string[] => {
    if (!sid || sid === SCOPE_ID_ALL) return [SCOPE_ID_ALL];
    return sid
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  const getExistingProjectIds = (user: AdminUser | null): string[] =>
    Array.from(new Set((user?.projectIds ?? []).filter(Boolean)));

  const openAssignModal = (user: AdminUser, existingRole?: AdminUserRole) => {
    setSelectedUser(user);
    if (existingRole) {
      setEditingRole(existingRole);
      setRole(existingRole.role);
      setScope(existingRole.scope);
      setProjectId(existingRole.projectId ?? "");
      const sid = existingRole.scopeId ?? existingRole.projectId ?? null;
      const ids = parseScopeIds(sid);
      if (existingRole.scope === "org") {
        setSelectedOrganizationIds(ids);
        setSelectedProjectIds([]);
      } else {
        setSelectedProjectIds(
          Array.from(new Set([
            ...ids.filter((id) => id !== SCOPE_ID_ALL),
            ...getExistingProjectIds(user),
          ])),
        );
        setSelectedOrganizationIds([SCOPE_ID_ALL]);
      }
    } else {
      setEditingRole(null);
      setRole(rolesList[0]?.name ?? "");
      setScope("org");
      setProjectId("");
      setSelectedOrganizationIds([SCOPE_ID_ALL]);
      setSelectedProjectIds([]);
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
    setEditingRole(null);
    setProjectId("");
    setSelectedOrganizationIds([SCOPE_ID_ALL]);
    setSelectedProjectIds([]);
  };

  const closeNewUserModal = () => {
    setIsNewUserModalOpen(false);
    setNewUserEmail("");
    setNewUserDisplayName("");
    setNewUserRole("OrgAdmin");
    setScope("org");
    setSelectedOrganizationIds([SCOPE_ID_ALL]);
    setSelectedProjectIds([]);
  };

  const handleCreateUser = () => {
    if (!newUserEmail?.trim()) {
      toast({
        title: "Email required",
        description: "Please enter an email address.",
        variant: "destructive",
      });
      return;
    }
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
    if (!emailRegex.test(newUserEmail.trim())) {
      toast({
        title: "Invalid email format",
        description: "Please enter a valid email address (e.g., user@example.com).",
        variant: "destructive",
      });
      return;
    }

    if (!newUserDisplayName?.trim()) {
      toast({
        title: "Display name required",
        description: "Please enter a display name.",
        variant: "destructive",
      });
      return;
    }
    if (scope === "project" && selectedProjectIds.length === 0) {
      toast({
        title: "Project required",
        description: "Select at least one synced project.",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate({
      email: newUserEmail.trim(),
      displayName: newUserDisplayName.trim(),
      role: newUserRole,
      scope: scope,
      organizationIds: scope === "org" ? selectedOrganizationIds : undefined,
      projectIds: scope === "project" ? selectedProjectIds : undefined,
    });
  };

  const assignRoleMutation = useMutation({
    mutationFn: async (payload: {
      userId: string;
      role: string;
      scope: "org" | "project";
      projectId?: string;
      organizationIds?: string[];
      projectIds?: string[];
    }) => {
      const url = getApiUrl("/api/admin/roles");
      const options = await buildAuthRequest(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = await fetch(url, options);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to assign role",
        );
      }

      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Role assigned",
        description: "User role has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      closeModal();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to assign role",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (userRoleId: string) => {
      const url = getApiUrl(`/api/admin/roles/${userRoleId}`);
      const options = await buildAuthRequest(url, {
        method: "DELETE",
        credentials: "include",
      });
      const res = await fetch(url, options);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to remove role",
        );
      }
    },
    onSuccess: () => {
      toast({
        title: "Role removed",
        description: "User role has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setRoleToRemove(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove role",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
      setRoleToRemove(null);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const url = getApiUrl(`/api/admin/users/${userId}`);
      const options = await buildAuthRequest(url, {
        method: "DELETE",
        credentials: "include",
      });
      const res = await fetch(url, options);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to delete user",
        );
      }
    },
    onSuccess: () => {
      toast({
        title: "User deactivated",
        description: "The user has been deactivated and can no longer access the platform. Their data has been retained.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setUserToRemove(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove user",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
      setUserToRemove(null);
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (payload: {
      email: string;
      displayName: string;
      role?: string;
      scope?: "org" | "project";
      organizationIds?: string[];
      projectIds?: string[];
    }) => {
      const url = getApiUrl("/api/admin/users");
      const options = await buildAuthRequest(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = await fetch(url, options);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "Failed to create user",
        );
      }

      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "User created",
        description: "New user has been created with OrgAdmin role.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      closeNewUserModal();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create user",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!selectedUser) return;
    if (!role?.trim()) {
      toast({
        title: "Role required",
        description: "Please select a role.",
        variant: "destructive",
      });
      return;
    }
    const payload: {
      userId: string;
      role: string;
      scope: "org" | "project";
      projectId?: string;
      organizationIds?: string[];
      projectIds?: string[];
    } = {
      userId: selectedUser.userId,
      role,
      scope,
    };
    if (scope === "org") {
      payload.organizationIds = selectedOrganizationIds.length
        ? selectedOrganizationIds
        : [SCOPE_ID_ALL];
    } else {
      if (selectedProjectIds.length === 0) {
        toast({
          title: "Project required",
          description: "Select at least one synced project.",
          variant: "destructive",
        });
        return;
      }
      payload.projectIds = selectedProjectIds;
      if (
        selectedProjectIds.length === 1 &&
        selectedProjectIds[0] !== SCOPE_ID_ALL
      ) {
        payload.projectId = selectedProjectIds[0];
      }
    }
    assignRoleMutation.mutate(payload);
  };

  const isTenantAdmin = useMemo(() => {
    if (!me?.roles) return false;
    return me.roles.some((r) => r.role === "TenantAdmin");
  }, [me]);

  // One row per role assignment so Edit/Remove target the correct role
  type TableRow = { user: AdminUser; userRole: AdminUserRole | null };
  const rows = useMemo(() => {
    const list: TableRow[] = [];
    (users ?? []).forEach((user) => {
      if (user.roles.length === 0) {
        list.push({ user, userRole: null });
      } else {
        user.roles.forEach((userRole) => {
          list.push({ user, userRole });
        });
      }
    });
    return list;
  }, [users]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        icon={UserCog}
        title="User Access"
        subtitle="Manage user roles for this organization."
        color="rose"
      />

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Users & roles</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleDownloadTemplate}
            disabled={isDownloadingTemplate}
            className="gap-2"
          >
            {isDownloadingTemplate ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            )}
            Download Template
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsBulkOpen(true)}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Bulk Upload
          </Button>
          <Button
            onClick={() => setIsNewUserModalOpen(true)}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            Add New User
          </Button>
        </div>
      </div>

      <BulkUploadDialog
        open={isBulkOpen}
        onOpenChange={setIsBulkOpen}
        buildAuthHeaders={buildAuthHeaders}
        onCompleted={() =>
          queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] })
        }
      />

      {/* Search Input */}
      <div className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by user name or email"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-9 py-2 rounded-md border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Clear search"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead className="w-[160px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRowsSkeleton rows={5} columns={5} />}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-sm text-muted-foreground"
                >
                  {searchTerm.trim()
                    ? "No users found"
                    : "No users found for this organization."}
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ user, userRole }) => {
              const rowKey = userRole
                ? `${user.userId}-${userRole.userRoleId}`
                : `${user.userId}-no-role`;
              return (
                <TableRow key={rowKey}>
                  <TableCell>{user.displayName ?? user.email}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{userRole ? userRole.role : "—"}</TableCell>
                  <TableCell>
                    {userRole
                      ? userRole.scopeId === SCOPE_ID_ALL
                        ? userRole.scope === "project"
                          ? "All projects"
                          : "All org"
                        : userRole.scope === "project"
                          ? "Project"
                          : "Org"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={
                        userRole
                          ? `Edit ${userRole.role} (${userRole.scope})`
                          : "Assign role"
                      }
                      onClick={() =>
                        openAssignModal(user, userRole ?? undefined)
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {userRole && isTenantAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete User"
                        onClick={() => setUserToRemove(user)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {page} of {Math.max(totalPages, 1)} ({total} users)
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
            disabled={page <= 1 || isLoading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPage((prev) => Math.min(prev + 1, Math.max(totalPages, 1)))
            }
            disabled={page >= Math.max(totalPages, 1) || isLoading}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? "Edit Role" : "Assign Role"}
            </DialogTitle>
            <DialogDescription>
              Configure role and scope for the selected user. Existing roles are
              not removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>User</Label>
              <div className="rounded-md border px-3 py-2 text-sm bg-muted">
                {selectedUser
                  ? `${selectedUser.displayName ?? selectedUser.email} (${selectedUser.email})`
                  : "No user selected"}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v)}
                disabled={rolesList.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      rolesList.length === 0 ? "Loading roles…" : "Select role"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {rolesList.map((r) => (
                    <SelectItem key={r.id} value={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) => {
                  const nextScope = v as "org" | "project";
                  setScope(nextScope);
                  setSelectedOrganizationIds([SCOPE_ID_ALL]);
                  setSelectedProjectIds(
                    nextScope === "project" ? getExistingProjectIds(selectedUser) : [],
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="org">Organization</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "org" && (
              <div className="space-y-2">
                <Label>Organizations</Label>
                <p className="text-xs text-muted-foreground">
                  Select ALL or one or more organizations. Default: ALL.
                </p>
                <div className="rounded-md border border-input bg-background p-3 space-y-2 max-h-48 overflow-y-auto">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedOrganizationIds.includes(SCOPE_ID_ALL)}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedOrganizationIds([SCOPE_ID_ALL]);
                        else setSelectedOrganizationIds([]);
                      }}
                    />
                    <span className="text-sm font-medium">ALL</span>
                  </label>
                  {orgList.map((org) => (
                    <label
                      key={org.id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedOrganizationIds.includes(org.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOrganizationIds((prev) =>
                              prev.includes(SCOPE_ID_ALL)
                                ? [org.id]
                                : prev.includes(org.id)
                                  ? prev
                                  : [...prev, org.id],
                            );
                          } else {
                            setSelectedOrganizationIds((prev) =>
                              prev.filter((id) => id !== org.id),
                            );
                          }
                        }}
                        disabled={selectedOrganizationIds.includes(
                          SCOPE_ID_ALL,
                        )}
                      />
                      <span className="text-sm">{org.name}</span>
                    </label>
                  ))}
                  {orgList.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No organizations configured. Add organizations in the
                      Organizations page.
                    </p>
                  )}
                </div>
              </div>
            )}
            {scope === "project" && (
              <div className="space-y-2">
                <Label>Projects</Label>
                <p className="text-xs text-muted-foreground">
                  Select one or more synced projects. Organizations shown as parent nodes.
                </p>
                <div className="rounded-md border border-input bg-background p-3 space-y-1 max-h-64 overflow-y-auto">
                  {projectTree.map(({ org, projects }) => (
                    <Collapsible key={org.id} defaultOpen className="group/org">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/60 text-left cursor-pointer"
                        >
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/org:rotate-0 group-data-[state=closed]/org:-rotate-90" />
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm font-medium truncate">
                            {org.name}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">
                            ({projects.length} project
                            {projects.length !== 1 ? "s" : ""})
                          </span>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pl-6 space-y-1 py-1">
                          {projects.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-1">
                              No projects in this organization
                            </p>
                          ) : (
                            projects.map((proj) => (
                              <label
                                key={proj.id}
                                className="flex items-center gap-2 cursor-pointer py-1 pl-1 rounded hover:bg-muted/40"
                              >
                                <Checkbox
                                  checked={selectedProjectIds.includes(proj.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedProjectIds((prev) =>
                                        prev.includes(SCOPE_ID_ALL)
                                          ? [proj.id]
                                          : prev.includes(proj.id)
                                            ? prev
                                            : [...prev, proj.id],
                                      );
                                    } else {
                                      setSelectedProjectIds((prev) =>
                                        prev.filter((id) => id !== proj.id),
                                      );
                                    }
                                  }}
                                />
                                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="text-sm truncate">
                                  {proj.name}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                  {projectTree.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">
                      No organizations or projects found. Add organizations with
                      PAT in the Organizations page and sync projects.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                assignRoleMutation.isPending ||
                rolesList.length === 0 ||
                (scope === "project" && selectedProjectIds.length === 0)
              }
            >
              {assignRoleMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!roleToRemove}
        onOpenChange={(open) => {
          if (!open) setRoleToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove role?</AlertDialogTitle>
            <AlertDialogDescription>
              {roleToRemove ? (
                <>
                  This will remove the role <strong>{roleToRemove.role}</strong>{" "}
                  ({roleToRemove.scope === "project" ? "Project" : "Org"}) from
                  the user. You cannot remove the last TenantAdmin for an
                  organization.
                </>
              ) : (
                "This will remove the selected role from the user. You cannot remove the last TenantAdmin for an organization."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (roleToRemove) {
                  removeRoleMutation.mutate(roleToRemove.userRoleId);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!userToRemove}
        onOpenChange={(open) => {
          if (!open) setUserToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate{" "}
              <strong>{userToRemove?.displayName ?? userToRemove?.email}</strong>?
              {" "}The user will no longer be able to access the platform, but their data will be retained. This action can be reversed by a database administrator if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (userToRemove) {
                  deleteUserMutation.mutate(userToRemove.userId);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteUserMutation.isPending ? "Deactivating..." : "Deactivate User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isNewUserModalOpen} onOpenChange={(open) => !open && closeNewUserModal()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a new user and assign OrgAdmin role. The user will have access to all organizations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Email</Label>
              <input
                type="email"
                placeholder="user@example.com"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
              />
            </div>
            <div className="space-y-1">
              <Label>Display Name</Label>
              <input
                type="text"
                placeholder="John Doe"
                value={newUserDisplayName}
                onChange={(e) => setNewUserDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
              />
            </div>
            <div className="space-y-1">
              <Label>Tenant ID</Label>
              <div className="rounded-md border px-3 py-2 text-sm bg-muted font-mono break-all">
                {isAmp
                  ? (me?.roles?.[0]?.tenantId ?? "Loading…")
                  : (account?.tenantId ?? (account?.idTokenClaims?.tid as string) ?? "Not available")}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Default Role</Label>
              <Select
                value={newUserRole}
                onValueChange={(v) => setNewUserRole(v)}
                disabled={rolesList.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      rolesList.length === 0 ? "Loading roles…" : "Select role"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {rolesList.map((r) => (
                    <SelectItem key={r.id} value={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) => {
                  const nextScope = v as "org" | "project";
                  setScope(nextScope);
                  setSelectedOrganizationIds([SCOPE_ID_ALL]);
                  setSelectedProjectIds(
                    nextScope === "project" ? getExistingProjectIds(selectedUser) : [],
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="org">Organization</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "org" && (
              <div className="space-y-2">
                <Label>Organizations</Label>
                <p className="text-xs text-muted-foreground">
                  Select ALL or one or more organizations. Default: ALL.
                </p>
                <div className="rounded-md border border-input bg-background p-3 space-y-2 max-h-48 overflow-y-auto">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedOrganizationIds.includes(SCOPE_ID_ALL)}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedOrganizationIds([SCOPE_ID_ALL]);
                        else setSelectedOrganizationIds([]);
                      }}
                    />
                    <span className="text-sm font-medium">ALL</span>
                  </label>
                  {orgList.map((org) => (
                    <label
                      key={org.id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedOrganizationIds.includes(org.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOrganizationIds((prev) =>
                              prev.includes(SCOPE_ID_ALL)
                                ? [org.id]
                                : prev.includes(org.id)
                                  ? prev
                                  : [...prev, org.id],
                            );
                          } else {
                            setSelectedOrganizationIds((prev) =>
                              prev.filter((id) => id !== org.id),
                            );
                          }
                        }}
                        disabled={selectedOrganizationIds.includes(
                          SCOPE_ID_ALL,
                        )}
                      />
                      <span className="text-sm">{org.name}</span>
                    </label>
                  ))}
                  {orgList.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No organizations configured. Add organizations in the
                      Organizations page.
                    </p>
                  )}
                </div>
              </div>
            )}
            {scope === "project" && (
              <div className="space-y-2">
                <Label>Projects</Label>
                <p className="text-xs text-muted-foreground">
                  Select one or more synced projects. Organizations shown as parent nodes.
                </p>
                <div className="rounded-md border border-input bg-background p-3 space-y-1 max-h-64 overflow-y-auto">
                  {projectTree.map(({ org, projects }) => (
                    <Collapsible key={org.id} defaultOpen>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full py-1.5 hover:bg-muted/50 rounded-md px-1 group">
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">
                          {org.name}
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pl-6 py-1 space-y-2">
                          {projects.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No projects synced.
                            </p>
                          ) : (
                            projects.map((proj) => (
                              <label
                                key={proj.id}
                                className="flex items-center gap-2 cursor-pointer group"
                              >
                                <Checkbox
                                  checked={selectedProjectIds.includes(proj.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedProjectIds((prev) =>
                                        prev.includes(SCOPE_ID_ALL)
                                          ? [proj.id]
                                          : prev.includes(proj.id)
                                            ? prev
                                            : [...prev, proj.id],
                                      );
                                    } else {
                                      setSelectedProjectIds((prev) =>
                                        prev.filter((id) => id !== proj.id),
                                      );
                                    }
                                  }}
                                />
                                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="text-sm truncate">
                                  {proj.name}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                  {projectTree.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">
                      No organizations or projects found. Add organizations with
                      PAT in the Organizations page and sync projects.
                    </p>
                  )}
                </div>
              </div>
            )}
            
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeNewUserModal}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={
                createUserMutation.isPending ||
                !newUserEmail.trim() ||
                !newUserDisplayName.trim() ||
                (scope === "project" && selectedProjectIds.length === 0)
              }
            >
              {createUserMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
