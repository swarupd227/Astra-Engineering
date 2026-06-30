import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Shield } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getApiUrl } from "@/lib/api-config";
import { useMsal } from "@azure/msal-react";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { addAuthToRequest } from "@/lib/auth-request";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";
import { FEATURE_REGISTRY } from "@/config/featurePermissions";
import {
  getResourceActionMatrixByFeature,
  getActivityKeyForResourceAction,
  ACTION_COLUMNS,
  type ResourceActionRow,
  type ActionKey,
} from "@/config/activityRegistry";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

type RoleRow = { id: number; name: string };

/** Role names to exclude from dropdown based on current user's role. */
function getRolesExcludedFromDropdown(
  userRoles: Array<{ role: string }> | undefined
): string[] {
  if (!userRoles?.length) return [];
  const roleSet = new Set(userRoles.map((r) => r.role));
  if (roleSet.has("TenantAdmin")) return [];
  if (roleSet.has("OrgAdmin")) return ["TenantAdmin"];
  if (roleSet.has("ProjectAdmin")) return ["TenantAdmin", "OrgAdmin"];
  return [];
}

/** Static resource × action matrix by feature (FEATURE_REGISTRY is static). */
const RESOURCE_ACTION_MATRIX = getResourceActionMatrixByFeature(
  FEATURE_REGISTRY.map((f) => f.id)
);

/** Project-scoped features: project (ADO) and golden repo only. */
const PROJECT_FEATURE_IDS = ["ado", "golden_repos"];

/** Project activities — only project and golden repo resources (exclude other ado/sdlc). */
const PROJECT_ACTIVITY_ROWS: ResourceActionRow[] = PROJECT_FEATURE_IDS.flatMap(
  (fid) => RESOURCE_ACTION_MATRIX[fid] ?? []
).filter(
  (row) =>
    row.resource.toLowerCase().includes("project") ||
    row.resource.toLowerCase().includes("golden")
);

/** Non-project features for the main list (excludes sdlc, ado). */
const NON_PROJECT_FEATURES = FEATURE_REGISTRY.filter(
  (f) => !PROJECT_FEATURE_IDS.includes(f.id)
);

/** Artifact Organization feature — shown before Project activities. */
const ARTIFACT_ORG_FEATURE = FEATURE_REGISTRY.find((f) => f.id === "artifact_org");
/** Non-project features excluding artifact_org (shown after Project activities). */
const NON_PROJECT_FEATURES_EXCLUDING_ORG = NON_PROJECT_FEATURES.filter(
  (f) => f.id !== "artifact_org"
);

type RoleActivityPerm = { activity_key: string; enabled: boolean };

const TENANT_ADMIN_ONLY_ACTIVITY_KEYS = new Set(["GOLDEN_REPOS_CREATE"]);

export default function AdminActivityConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
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
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

  const buildAuthRequest = async (url: string, options: RequestInit = {}) => {
    if (!authReady) {
      throw new Error("Not signed in");
    }
    return addAuthToRequest(url, options);
  };

  const { data: me } = useQuery<{
    user: { id: string; email: string; displayName?: string | null };
    roles: Array<{ role: string; scope: string }>;
  } | null>({
    queryKey: ["/api/auth/me", authKey],
    enabled: authReady,
    queryFn: async () => {
      const url = getApiUrl("/api/auth/me");
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
  });

  const excludedRoleNames = getRolesExcludedFromDropdown(me?.roles);
  const isTenantAdmin =
    me?.roles?.some((r) => r.role === "TenantAdmin") ?? false;

  const { data: roles = [], isLoading: rolesLoading } = useQuery<RoleRow[]>({
    queryKey: ["/api/admin/roles", authKey],
    enabled: authReady,
    queryFn: async () => {
      const url = getApiUrl("/api/admin/roles");
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to load roles");
      }
      return res.json();
    },
  });

  const visibleRoles = roles.filter((r) => !excludedRoleNames.includes(r.name));
  const firstRoleId = visibleRoles[0]?.id ?? null;
  const effectiveRoleId =
    selectedRoleId && visibleRoles.some((r) => r.id === selectedRoleId)
      ? selectedRoleId
      : firstRoleId;
  const selectedRole = roles.find((r) => r.id === effectiveRoleId);
  const isConfiguringTenantAdmin = selectedRole?.name === "TenantAdmin";

  const { data: rolePerms = [] } = useQuery<RoleActivityPerm[]>({
    queryKey: ["/api/admin/role-activity-permissions", effectiveRoleId, authKey],
    enabled: authReady && effectiveRoleId != null,
    queryFn: async () => {
      const url = getApiUrl(`/api/admin/role-activity-permissions?roleId=${effectiveRoleId}`);
      const options = await buildAuthRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to load permissions");
      }
      return res.json();
    },
  });

  const permMap = Object.fromEntries(
    rolePerms.map((p) => [p.activity_key, p.enabled])
  );

  const savePermMutation = useMutation({
    mutationFn: async ({
      activityKey,
      enabled,
    }: { activityKey: string; enabled: boolean }) => {
      const url = getApiUrl("/api/admin/role-activity-permissions");
      const options = await buildAuthRequest(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: effectiveRoleId,
          activityKey,
          enabled,
        }),
      });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/role-activity-permissions", effectiveRoleId],
      });
      toast({ title: "Saved", description: "Activity permission updated." });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (rolesLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (visibleRoles.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          icon={Shield}
          title="Activity Configuration"
          subtitle="Manage activity permissions by feature per role"
          color="orange"
        />
        <Card className="border-l-[3px] border-l-orange-500">
          <CardContent className="pt-6">
            <p className="text-muted-foreground">No roles found. Assign roles from User Access first.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Shield}
        title="Activity Configuration"
        subtitle="Manage activity permissions by feature per role"
        color="orange"
      />

      <Card className="border-l-[3px] border-l-orange-500">
        <CardHeader>
          <CardTitle>Feature permissions by role</CardTitle>
          <CardDescription>
            Read, Write, Update, Delete, Create-only, Viewer-only. Changes apply to the selected role (saving not yet connected).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid w-full max-w-sm gap-2">
            <Label htmlFor="role-select">Select Role</Label>
            <Select
              value={effectiveRoleId != null ? String(effectiveRoleId) : ""}
              onValueChange={(v) => setSelectedRoleId(v ? parseInt(v, 10) : null)}
            >
              <SelectTrigger id="role-select">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {visibleRoles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-orange-500">
            <CardHeader>
              <CardTitle>Activity permissions by resource × action</CardTitle>
              <CardDescription>
                {isConfiguringTenantAdmin
                  ? "TenantAdmin has full access to all activities. Select another role to configure permissions."
                  : "Resource rows with checkboxes for view, create, update, delete, sync, test."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Artifact Organizations — shown before Project activities */}
              {ARTIFACT_ORG_FEATURE && (() => {
                const rows: ResourceActionRow[] = RESOURCE_ACTION_MATRIX[ARTIFACT_ORG_FEATURE.id] ?? [];
                if (rows.length === 0) return null;
                return (
                  <Collapsible key={ARTIFACT_ORG_FEATURE.id} defaultOpen>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                      >
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{ARTIFACT_ORG_FEATURE.name}</span>
                        <Badge variant="secondary" className="ml-2">
                          {rows.length} resources
                        </Badge>
                        {isConfiguringTenantAdmin ? (
                          <Badge variant="outline" className="ml-1 text-xs">Full access</Badge>
                        ) : isTenantAdmin ? (
                          <Badge variant="outline" className="ml-1 text-xs">Editable</Badge>
                        ) : (
                          <Badge variant="outline" className="ml-1 text-xs">TenantAdmin only</Badge>
                        )}
                        <span className="text-muted-foreground text-sm ml-2">
                          {ARTIFACT_ORG_FEATURE.description}
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[200px] font-mono text-sm">Resource</TableHead>
                              {ACTION_COLUMNS.map((col) => (
                                <TableHead key={col} className="text-center w-[72px] capitalize">
                                  {col}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((row) => (
                              <TableRow key={row.resource}>
                                <TableCell className="font-mono text-sm">{row.resource}</TableCell>
                                {ACTION_COLUMNS.map((col) => {
                                  const activityKey = getActivityKeyForResourceAction(row.resource, col as ActionKey);
                                  const hasPerm = permMap[activityKey!];
                                  const checked = activityKey ? (hasPerm !== false) : !!row[col as keyof ResourceActionRow];
                                  const canEdit =
                                    activityKey &&
                                    !isConfiguringTenantAdmin &&
                                    isTenantAdmin;
                                  return (
                                    <TableCell key={col} className="text-center">
                                      <div className="flex justify-center">
                                        <Checkbox
                                          checked={checked}
                                          disabled={!canEdit}
                                          onCheckedChange={
                                            canEdit
                                              ? (val) =>
                                                  savePermMutation.mutate({
                                                    activityKey: activityKey!,
                                                    enabled: val === true,
                                                  })
                                              : undefined
                                          }
                                        />
                                      </div>
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })()}

              {/* Project activities — expandable/collapsible, editable by TenantAdmin */}
              {PROJECT_ACTIVITY_ROWS.length > 0 && (
                <Collapsible defaultOpen>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">Project activities</span>
                      <Badge variant="secondary" className="ml-2">
                        {PROJECT_ACTIVITY_ROWS.length} resources
                      </Badge>
                      {isTenantAdmin && (
                        <Badge variant="outline" className="ml-1 text-xs">Editable</Badge>
                      )}
                      <span className="text-muted-foreground text-sm ml-2">
                        Project and Golden Repo resources
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[200px] font-mono text-sm">Resource</TableHead>
                            {ACTION_COLUMNS.map((col) => (
                              <TableHead key={col} className="text-center w-[72px] capitalize">
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {PROJECT_ACTIVITY_ROWS.map((row) => (
                            <TableRow key={row.resource}>
                              <TableCell className="font-mono text-sm">{row.resource}</TableCell>
                              {ACTION_COLUMNS.map((col) => {
                                const activityKey = getActivityKeyForResourceAction(row.resource, col as ActionKey);
                                const hasPerm = permMap[activityKey!];
                                const checked = activityKey ? (hasPerm !== false) : !!row[col as keyof ResourceActionRow];
                                const isTenantAdminOnlyActivity = !!activityKey && TENANT_ADMIN_ONLY_ACTIVITY_KEYS.has(activityKey);
                                const canEdit =
                                  activityKey &&
                                  !isConfiguringTenantAdmin &&
                                  isTenantAdmin &&
                                  !isTenantAdminOnlyActivity;
                                return (
                                  <TableCell key={col} className="text-center">
                                    <div className="flex justify-center">
                                      <Checkbox
                                        checked={checked}
                                        disabled={!canEdit}
                                        onCheckedChange={
                                          canEdit
                                            ? (val) =>
                                                savePermMutation.mutate({
                                                  activityKey: activityKey!,
                                                  enabled: val === true,
                                                })
                                            : undefined
                                        }
                                      />
                                    </div>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Other features (non-project, excluding artifact_org) */}
              {NON_PROJECT_FEATURES_EXCLUDING_ORG.map((feature) => {
                const rows: ResourceActionRow[] = RESOURCE_ACTION_MATRIX[feature.id] ?? [];
                if (rows.length === 0) return null;
                const isOrgFeature = feature.id === "artifact_org";
                return (
                  <Collapsible key={feature.id} defaultOpen>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                      >
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{feature.name}</span>
                        <Badge variant="secondary" className="ml-2">
                          {rows.length} resources
                        </Badge>
                        {isOrgFeature && (
                          <Badge variant="outline" className="ml-1 text-xs">Editable</Badge>
                        )}
                        <span className="text-muted-foreground text-sm ml-2">
                          {feature.description}
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[200px] font-mono text-sm">Resource</TableHead>
                              {ACTION_COLUMNS.map((col) => (
                                <TableHead key={col} className="text-center w-[72px] capitalize">
                                  {col}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((row) => (
                              <TableRow key={row.resource}>
                                <TableCell className="font-mono text-sm">{row.resource}</TableCell>
                                {ACTION_COLUMNS.map((col) => {
                                  const activityKey = getActivityKeyForResourceAction(
                                    row.resource,
                                    col as ActionKey
                                  );
                                  const canEdit =
                                    !!activityKey && !isConfiguringTenantAdmin;
                                  const hasPerm = activityKey
                                    ? permMap[activityKey]
                                    : undefined;
                                  const checked = activityKey
                                    ? hasPerm !== false
                                    : !!row[col as keyof ResourceActionRow];
                                  return (
                                    <TableCell key={col} className="text-center">
                                      <div className="flex justify-center">
                                        <Checkbox
                                          checked={checked}
                                          disabled={!canEdit}
                                          onCheckedChange={
                                            canEdit && activityKey
                                              ? (val) =>
                                                  savePermMutation.mutate({
                                                    activityKey,
                                                    enabled: val === true,
                                                  })
                                              : undefined
                                          }
                                        />
                                      </div>
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
              {(RESOURCE_ACTION_MATRIX["other"]?.length ?? 0) > 0 && (
                <Collapsible defaultOpen>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">Other</span>
                      <Badge variant="outline" className="ml-2">
                        {RESOURCE_ACTION_MATRIX["other"].length} resources
                      </Badge>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[200px] font-mono text-sm">Resource</TableHead>
                            {ACTION_COLUMNS.map((col) => (
                              <TableHead key={col} className="text-center w-[72px] capitalize">
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {RESOURCE_ACTION_MATRIX["other"].map((row) => (
                            <TableRow key={row.resource}>
                              <TableCell className="font-mono text-sm">
                                {row.resource}
                              </TableCell>
                              {ACTION_COLUMNS.map((col) => {
                                const activityKey =
                                  getActivityKeyForResourceAction(
                                    row.resource,
                                    col as ActionKey
                                  );
                                const canEdit =
                                  !!activityKey && !isConfiguringTenantAdmin;
                                const hasPerm = activityKey
                                  ? permMap[activityKey]
                                  : undefined;
                                const checked = activityKey
                                  ? hasPerm !== false
                                  : !!row[col as keyof ResourceActionRow];
                                return (
                                  <TableCell key={col} className="text-center">
                                    <div className="flex justify-center">
                                      <Checkbox
                                        checked={checked}
                                        disabled={!canEdit}
                                        onCheckedChange={
                                          canEdit && activityKey
                                            ? (val) =>
                                                savePermMutation.mutate({
                                                  activityKey,
                                                  enabled: val === true,
                                                })
                                            : undefined
                                        }
                                      />
                                    </div>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
    </div>
  );
}
