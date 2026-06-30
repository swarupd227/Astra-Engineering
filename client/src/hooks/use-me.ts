import { useQuery } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import { getApiUrl } from "@/lib/api-config";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import { addUserInfoToRequestAmplify } from "@/utils/api-interceptor-amplify";
import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";

export type MeRole = {
  role: string;
  scope: string;
  scopeId: string;
  tenantId: string;
  provider: string;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName?: string | null;
    provider?: string;
    isMfaEnabled?: boolean;
    onboardingCompleted?: boolean;
  };
  roles: MeRole[];
  canCreateProject?: boolean;
  onboardingCompleted?: boolean;
};

export function useMe() {
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const amplifyAuth = useAmplifyAuthOptional();
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();
  const keycloakAccount = isKeycloak ? getKeycloakAccount() : null;
  const authKey = isAmp
    ? amplifyAuth?.user?.sub ?? ""
    : isKeycloak
      ? keycloakAccount?.accountKey ?? ""
      : account?.localAccountId ?? "";
  const enabled = isAmp
    ? !!(amplifyAuth?.user?.email && !amplifyAuth?.isLoading)
    : isKeycloak
      ? isKeycloakAuthenticated()
      : !!account;

  return useQuery<MeResponse | null>({
    queryKey: ["/api/auth/me", authKey],
    enabled,
    staleTime: 60_000,
    refetchOnMount: false,
    retry: false,
    queryFn: async () => {
      const url = getApiUrl("/api/auth/me");
      const addInfo = isAmp ? addUserInfoToRequestAmplify : addUserInfoToRequest;
      const options = await addInfo(url, { credentials: "include" });
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `auth/me ${res.status}`);
      }
      return (await res.json()) as MeResponse;
    },
  });
}
