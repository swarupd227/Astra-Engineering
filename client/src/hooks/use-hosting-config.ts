import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import type { FeatureKey } from "@/lib/features";

export type HostingConfig = {
  hosting: "azure" | "aws";
  allowedWorkItemPlatforms: ("ado" | "jira")[];
  /**
   * Optional public WebSocket URL the Chrome extension should use (e.g. when the
   * app is fronted by AWS API Gateway, which doesn't support WS upgrades and the
   * extension must connect directly to the EC2 host on port 4000).
   * Format: `ws://host:port` or `wss://host:port` — extension appends `/ws/recorder`.
   * When null/undefined, the recorder falls back to `window.location.origin`.
   */
  extensionWsPublicUrl?: string | null;
  features?: Partial<Record<FeatureKey, boolean>>;
};

export function useHostingConfig() {
  return useQuery<HostingConfig>({
    queryKey: ["/api/platform/hosting"],
    queryFn: async () => {
      const res = await fetch(getApiUrl("/api/platform/hosting"), {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to load hosting configuration");
      }
      return res.json() as Promise<HostingConfig>;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

/**
 * True when server reports only Jira (typical DEVX_HOSTING=aws).
 * Returns `true` while the hosting config is still loading so that
 * ADO-specific queries are NOT fired before we know the hosting mode.
 */
export function useJiraOnlyWorkItems(): boolean {
  const { data, isLoading } = useHostingConfig();
  if (isLoading || !data) return true;
  const p = data.allowedWorkItemPlatforms;
  return Array.isArray(p) && p.length === 1 && p[0] === "jira";
}

/**
 * @deprecated Specs push now uses project repo tool config (see use-backlog-data).
 * Legacy helper: true when tenant GitHub fallback may apply (Jira-only hosting, no project repo tool).
 */
export function useSpecsUsesGitHub(integrationType?: string): boolean {
  const jiraOnly = useJiraOnlyWorkItems();
  return jiraOnly || integrationType === "jira";
}

/** True once the hosting config has loaded (use to gate queries that depend on hosting). */
export function useHostingReady(): boolean {
  const { data } = useHostingConfig();
  return !!data;
}

/** True when ADO work items are allowed (Azure hosting or both). */
export function useAdoAllowed(): boolean {
  const { data, isLoading } = useHostingConfig();
  if (isLoading || !data) return false;
  return data.allowedWorkItemPlatforms.includes("ado");
}

/** True when Jira work items / integration are allowed for this deployment. */
export function useJiraAllowed(): boolean {
  const { data, isLoading } = useHostingConfig();
  if (isLoading || !data) return false;
  return data.allowedWorkItemPlatforms.includes("jira");
}

/** True when the new three-step Jira onboarding wizard is enabled. */
export function useJiraOnboardingWizardEnabled(): boolean {
  const { data, isLoading } = useHostingConfig();
  if (isLoading || !data) return false;
  return data.features?.jira_onboarding_wizard === true;
}

/**
 * Ask Astra welcome / reset chip strip (full order: features → golden → ADO → Jira → capabilities).
 * Server fallback list is kept in sync in `server/ai/superAgent/router.ts` (`getDefaultQuickReplies` general case).
 */
export const ASK_DEVX_WELCOME_QUICK_REPLIES: readonly string[] = [
  "Ask about Astra features",
  "Show golden repos",
  "Query ADO data",
  "Query Jira data",
  "Explore Modernization",
  "What can you do?",
];
