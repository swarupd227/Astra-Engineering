import { Redirect } from "wouter";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import { ComponentType, useEffect, useState } from "react";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";

type MeRole = { role: string; scope: string; scopeId: string; tenantId: string; provider: string };
type MeResponse = {
  user: { id: string; email: string; displayName?: string | null; provider?: string };
  roles: MeRole[];
};

interface AdminProtectedRouteProps {
  component: ComponentType<any>;
  /** Roles that can access this route. Default: ["TenantAdmin"] */
  allowedRoles?: string[];
}

export default function AdminProtectedRoute({
  component: Component,
  allowedRoles = ["TenantAdmin"],
}: AdminProtectedRouteProps) {
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();
  const amplifyAuth = useAmplifyAuthOptional();
  const isAuthenticated = useIsAuthenticated();
  const { accounts, inProgress } = useMsal();
  const account = accounts[0] ?? null;
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  useEffect(() => {
    if (inProgress === "none") {
      setHasCheckedAuth(true);
    }
  }, [inProgress]);

  const keycloakAccount = isKeycloak ? getKeycloakAccount() : null;
  const authKey = isAmp
    ? amplifyAuth?.user?.sub ?? ""
    : isKeycloak
      ? keycloakAccount?.accountKey ?? ""
      : account?.localAccountId ?? "";

  const { data: me, isLoading } = useQuery<MeResponse | null>({
    queryKey: ["/api/auth/me", authKey],
    enabled: isAmp
      ? !!amplifyAuth?.user
      : isKeycloak
        ? isKeycloakAuthenticated()
        : !!account && hasCheckedAuth && isAuthenticated,
    staleTime: 60_000,
    refetchOnMount: false,
    retry: false,
    queryFn: async () => {
      const url = getApiUrl("/api/auth/me");
      const options = await addUserInfoToRequest(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `auth/me ${res.status}`);
      }
      return (await res.json()) as MeResponse;
    },
  });

  const hasAllowedRole = me?.roles?.some((r) => allowedRoles.includes(r.role)) ?? false;

  if (isAmp) {
    // null = store not yet seeded on first render — treat as loading, not unauthenticated
    if (!amplifyAuth || amplifyAuth.isLoading) {
      return null;
    }
    if (!amplifyAuth.user) {
      return <Redirect to="/" />;
    }
  } else if (isKeycloak) {
    if (!isKeycloakAuthenticated()) {
      return <Redirect to="/" />;
    }
  } else {
    if (inProgress !== "none" || !hasCheckedAuth) {
      return null;
    }
    if (!isAuthenticated) {
      return <Redirect to="/" />;
    }
  }

  const identityReady = isAmp
    ? !!amplifyAuth?.user
    : isKeycloak
      ? isKeycloakAuthenticated()
      : !!account;
  if (isLoading || (identityReady && me === undefined)) {
    return null;
  }

  if (!hasAllowedRole) {
    return <Redirect to="/overview" />;
  }

  return <Component />;
}
