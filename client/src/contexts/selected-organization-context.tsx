import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsAuthenticated } from "@azure/msal-react";
import { apiRequest } from "@/lib/queryClient";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { isKeycloakAuthenticated } from "@/utils/keycloak-auth";

const STORAGE_KEY = "devx:selected-organization-id";
const STORAGE_NAME_KEY = "devx:selected-organization-name";
const ALL_ORGANIZATIONS_ID = "__all__";

export type GlobalOrganization = {
  id: string;
  name: string;
  sourceType: "all" | "ado" | "jira";
  description?: string;
};

type SelectedOrganizationContextValue = {
  organizations: GlobalOrganization[];
  selectedOrganizationId: string | null;
  selectedOrganization: GlobalOrganization | null;
  isLoading: boolean;
  setSelectedOrganizationId: (organizationId: string) => void;
};

const SelectedOrganizationContext =
  createContext<SelectedOrganizationContextValue | null>(null);

type OrganizationsResponse = Array<{
  id: string;
  name: string;
  sourceType?: "ado" | "jira";
  description?: string;
}>;

export const GLOBAL_ALL_ORGANIZATIONS_ID = ALL_ORGANIZATIONS_ID;

function readStoredOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STORAGE_KEY);
}

function persistSelectedOrganization(org: GlobalOrganization | null) {
  if (typeof window === "undefined") return;

  if (!org) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_NAME_KEY);
    return;
  }

  window.sessionStorage.setItem(STORAGE_KEY, org.id);
  window.sessionStorage.setItem(STORAGE_NAME_KEY, org.name);
}

export function SelectedOrganizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const amplifyAuth = useAmplifyAuthOptional();
  const msalAuthenticated = useIsAuthenticated();
  const keycloakMode = isKeycloakAuthMode();
  const authReady = isAmplifyAuthMode()
    ? !amplifyAuth?.isLoading && !!amplifyAuth?.user
    : keycloakMode
      ? isKeycloakAuthenticated()
      : msalAuthenticated;

  const [selectedOrganizationId, setSelectedOrganizationIdState] = useState<string | null>(
    () => readStoredOrganizationId()
  );
  const hasInitializedSelection = useRef(false);

  const { data, isLoading: orgsQueryLoading } = useQuery<OrganizationsResponse>({
    queryKey: ["/api/global-organizations", "global-selector"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/global-organizations");
      return response.json();
    },
    staleTime: 60_000,
    enabled: authReady,
  });

  const isLoading = authReady && orgsQueryLoading;

  const organizations = useMemo<GlobalOrganization[]>(
    () => {
      const fetchedOrganizations = Array.isArray(data)
        ? data
            .filter((org) => org?.id && org?.name)
            .map((org) => ({
              id: org.id,
              name: org.name,
              sourceType: org.sourceType ?? "ado",
              description: org.description,
            }))
        : [];

      return [
        {
          id: ALL_ORGANIZATIONS_ID,
          name: "All",
          sourceType: "all" as const,
        },
        ...fetchedOrganizations,
      ];
    },
    [data]
  );

  useEffect(() => {
    if (organizations.length === 0) {
      if (hasInitializedSelection.current) {
        persistSelectedOrganization(null);
      }
      return;
    }

    const matchedStored = selectedOrganizationId
      ? organizations.find((org) => org.id === selectedOrganizationId)
      : null;

    // Default to the first Jira organization if available, otherwise fall back to "All" (organizations[0])
    const firstJiraOrg = organizations.find((org) => org.sourceType === "jira");
    const nextSelection = matchedStored ?? firstJiraOrg ?? organizations[0];

    if (!hasInitializedSelection.current || nextSelection.id !== selectedOrganizationId) {
      hasInitializedSelection.current = true;
      setSelectedOrganizationIdState(nextSelection.id);
      persistSelectedOrganization(nextSelection);
    }
  }, [organizations, selectedOrganizationId]);

  const selectedOrganization =
    organizations.find((org) => org.id === selectedOrganizationId) ?? null;

  useEffect(() => {
    if (!selectedOrganization) return;
    persistSelectedOrganization(selectedOrganization);
  }, [selectedOrganization]);

  const setSelectedOrganizationId = useCallback((organizationId: string) => {
    const nextOrganization =
      organizations.find((org) => org.id === organizationId) ?? null;

    setSelectedOrganizationIdState(organizationId);
    persistSelectedOrganization(nextOrganization);
  }, [organizations]);

  const value = useMemo<SelectedOrganizationContextValue>(
    () => ({
      organizations,
      selectedOrganizationId,
      selectedOrganization,
      isLoading,
      setSelectedOrganizationId,
    }),
    [organizations, selectedOrganizationId, selectedOrganization, isLoading, setSelectedOrganizationId]
  );

  return (
    <SelectedOrganizationContext.Provider value={value}>
      {children}
    </SelectedOrganizationContext.Provider>
  );
}

export function useSelectedOrganization() {
  const context = useContext(SelectedOrganizationContext);

  if (!context) {
    throw new Error(
      "useSelectedOrganization must be used within SelectedOrganizationProvider"
    );
  }

  return context;
}
