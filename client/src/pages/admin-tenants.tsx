import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TenantSkeleton } from "@/components/ui/page-skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getApiUrl } from "@/lib/api-config";
import { useMsal } from "@azure/msal-react";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { addAuthToRequest } from "@/lib/auth-request";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";
import { Badge } from "@/components/ui/badge";

type TenantOverviewResponse = {
  tenant: {
    tenantId: string;
    name: string;
    description: string | null;
    vertical: string | null;
    status: string;
    createdAt: string;
  };
  subscription: {
    subscriptionType: string;
    maxUsers: number;
    tokenQuota: number;
    tokenUsed: number;
    startDate: string;
    expiryDate: string;
  } | null;
  userCount: number;
};

export default function AdminTenantsPage() {
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

  const {
    data,
    isLoading,
    error,
  } = useQuery<TenantOverviewResponse>({
    queryKey: ["/api/admin/tenants", authKey],
    enabled: authReady,
    queryFn: async () => {
      const url = getApiUrl("/api/admin/tenants");
      const options = await addAuthToRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to load tenants");
      }
      return res.json();
    },
  });

  if (!authReady) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Sign in to view tenants.</p>
      </div>
    );
  }

  if (isLoading) {
    return <TenantSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load tenant information: {(error as Error).message}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Tenant information is not available.</p>
      </div>
    );
  }

  const formatDate = (value?: string | null) => {
    if (value == null || String(value).trim() === "") return "—";
    const str = String(value).trim().replace(" ", "T");
    const date = new Date(str);
    return isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
  };

  const { tenant, subscription, userCount } = data;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={Building}
        title="Tenant Overview"
        subtitle="View subscription and usage details for your organization."
        color="blue"
      />

      <Card className="border-l-[3px] border-l-blue-500">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-xl">{tenant.name}</CardTitle>
            <p className="text-sm text-muted-foreground">Tenant ID: {tenant.tenantId}</p>
          </div>
          <Badge variant="secondary" className="uppercase">
            {tenant.status}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Vertical</p>
            <p className="font-medium">{tenant.vertical ?? "—"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Created</p>
            <p className="font-medium">{formatDate(tenant.createdAt)}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-sm text-muted-foreground">Description</p>
            <p className="font-medium">
              {tenant.description?.trim() ? tenant.description : "No description provided."}
            </p>
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <Link href="/admin/user-access">
              <Button variant="outline" size="sm">
                Manage Users
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-l-[3px] border-l-blue-500">
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {subscription ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">Plan</p>
                  <p className="font-medium">{subscription.subscriptionType}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Max Users</p>
                  <p className="font-medium">{subscription.maxUsers}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tokens</p>
                  <p className="font-medium">
                    {subscription.tokenUsed != null && subscription.tokenQuota != null
                      ? `${subscription.tokenUsed.toLocaleString()} / ${subscription.tokenQuota.toLocaleString()}`
                      : "—"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Start Date</p>
                    <p className="font-medium">{formatDate(subscription.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Expiry Date</p>
                    <p className="font-medium">{formatDate(subscription.expiryDate)}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                No active subscription was found for this tenant.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-l-[3px] border-l-blue-500">
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Users</p>
              <p className="text-3xl font-semibold">{userCount}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Need to adjust subscription limits or deactivate licenses? Contact support or your platform administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
