import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Building } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/lib/api-config";
import { useMsal } from "@azure/msal-react";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { addAuthToRequest } from "@/lib/auth-request";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";
import { useToast } from "@/hooks/use-toast";

type TenantDetail = {
  tenant: {
    tenantId: string;
    name: string;
    description: string | null;
    vertical: string | null;
    status: string;
    createdAt: string;
  };
  subscription: {
    id: string;
    subscriptionType: string;
    maxUsers: number;
    tokenQuota: number;
    tokenUsed: number;
    startDate: string;
    expiryDate: string;
  } | null;
  license: {
    licenseHash: string;
    integrityHash: string;
    createdAt: string;
  } | null;
  userCount: number;
};

type TenantUser = {
  displayName: string;
  email: string;
  provider: string;
  providerUserId: string;
  createdAt: string;
};

export default function AdminTenantDetailPage() {
  const [, params] = useRoute("/admin/tenants/:tenantId");
  const tenantId = params?.tenantId ?? "";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [maxUsers, setMaxUsers] = useState<number | "">("");
  const [expiryDate, setExpiryDate] = useState("");

  const { data: detail, isLoading } = useQuery<TenantDetail>({
    queryKey: ["/api/admin/tenants", tenantId, authKey],
    enabled: authReady && !!tenantId,
    queryFn: async () => {
      const url = getApiUrl(`/api/admin/tenants/${tenantId}`);
      const options = await addAuthToRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to load tenant");
      }
      return res.json();
    },
  });

  const { data: users = [] } = useQuery<TenantUser[]>({
    queryKey: ["/api/admin/tenants", tenantId, "users", authKey],
    enabled: authReady && !!tenantId,
    queryFn: async () => {
      const url = getApiUrl(`/api/admin/tenants/${tenantId}/users`);
      const options = await addAuthToRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const saveSubscription = useMutation({
    mutationFn: async (payload: { maxUsers?: number; expiryDate?: string }) => {
      const url = getApiUrl(`/api/admin/subscriptions/${tenantId}`);
      const options = await addAuthToRequest(url, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to update");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants", tenantId] });
      toast({ title: "Subscription updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  if (!tenantId || !authReady) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Invalid tenant or sign in required.</p>
      </div>
    );
  }

  if (isLoading || !detail) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const sub = detail.subscription;
  const maxUsersValue = maxUsers !== "" ? maxUsers : (sub?.maxUsers ?? 50);
  const expiryDateValue = expiryDate || (sub?.expiryDate ? sub.expiryDate.slice(0, 10) : "");

  const handleSave = () => {
    saveSubscription.mutate({
      maxUsers: typeof maxUsersValue === "number" ? maxUsersValue : undefined,
      expiryDate: expiryDateValue || undefined,
    });
  };

  return (
    <div className="p-6 space-y-8">
      <Link href="/admin/tenants">
        <Button variant="ghost" size="sm">← Tenants</Button>
      </Link>
      <PageHeader
        icon={Building}
        title={detail.tenant.name}
        color="blue"
      />

      {/* Section A — Tenant Info */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Tenant Info</h2>
        <div className="rounded-md border p-4 grid gap-2 max-w-md">
          <div><Label className="text-muted-foreground">Tenant Name</Label><p>{detail.tenant.name}</p></div>
          <div><Label className="text-muted-foreground">Description</Label><p>{detail.tenant.description ?? "—"}</p></div>
          <div><Label className="text-muted-foreground">Vertical</Label><p>{detail.tenant.vertical ?? "—"}</p></div>
          <div><Label className="text-muted-foreground">Status</Label><p>{detail.tenant.status}</p></div>
          <div><Label className="text-muted-foreground">Created At</Label><p>{detail.tenant.createdAt ? new Date(detail.tenant.createdAt).toLocaleString() : "—"}</p></div>
        </div>
      </section>

      {/* Section B — Subscription */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Subscription</h2>
        <div className="rounded-md border p-4 space-y-4 max-w-md">
          <div>
            <Label>Subscription Type</Label>
            <Select value={sub?.subscriptionType ?? "DEFAULT"} disabled>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">Default Subscription</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Max Users</Label>
            <Input
              type="number"
              min={1}
              value={maxUsers === "" ? (sub?.maxUsers ?? "") : maxUsers}
              onChange={(e) => {
                const v = e.target.value;
                setMaxUsers(v === "" ? "" : parseInt(v, 10));
              }}
            />
          </div>
          <div>
            <Label>Token Quota (read-only)</Label>
            <Input
              type="text"
              readOnly
              value={sub?.tokenQuota != null ? sub.tokenQuota.toLocaleString() : "—"}
            />
          </div>
          <div>
            <Label>Tokens Used (read-only)</Label>
            <Input
              type="text"
              readOnly
              value={sub?.tokenUsed != null ? sub.tokenUsed.toLocaleString() : "—"}
            />
          </div>
          <div>
            <Label>Start Date (read-only)</Label>
            <Input
              type="text"
              readOnly
              value={sub?.startDate ? new Date(sub.startDate).toLocaleDateString() : "—"}
            />
          </div>
          <div>
            <Label>Expiry Date</Label>
            <Input
              type="date"
              value={expiryDateValue}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
          <Button onClick={handleSave} disabled={saveSubscription.isPending}>
            Save
          </Button>
        </div>
      </section>

      {/* Section C — License */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">License</h2>
        <div className="rounded-md border p-4 grid gap-2 max-w-md">
          {detail.license ? (
            <>
              <div><Label className="text-muted-foreground">License Hash</Label><p className="font-mono text-sm">{detail.license.licenseHash}</p></div>
              <div><Label className="text-muted-foreground">Integrity Hash</Label><p className="font-mono text-sm break-all">{detail.license.integrityHash}</p></div>
              <div><Label className="text-muted-foreground">Created At</Label><p>{detail.license.createdAt ? new Date(detail.license.createdAt).toLocaleString() : "—"}</p></div>
            </>
          ) : (
            <p className="text-muted-foreground">No license found.</p>
          )}
        </div>
      </section>

      {/* Section D — Users */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Users</h2>
          <span className="text-muted-foreground">
            Total Users: {detail.userCount} / {sub?.maxUsers ?? "—"}
          </span>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Provider User ID</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center py-6">
                    No users.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell>{u.displayName || "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.provider || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{u.providerUserId || "—"}</TableCell>
                    <TableCell>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
