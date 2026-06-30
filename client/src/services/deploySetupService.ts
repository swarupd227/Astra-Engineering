import { getApiUrl } from "@/lib/api-config";

export interface AdoRepo {
  id: string;
  name: string;
  defaultBranch?: string;
}

export interface AdoBranch {
  name: string;
  objectId: string;
}

export type DeploymentType = "fullstack" | "single-appservice" | "single-swa";

export interface DeploySetupPayload {
  deploymentType: DeploymentType;
  sourceRepoId: string;
  sourceBranch: string;
  targetBranchMode: "new" | "existing";
  targetBranch: string;
  pipelineConfig: {
    environmentKey: string;
    environmentLabel: string;
    appServiceName: string;
    resourceGroupName: string;
    azureSubscription: string;
    appServiceUrl: string;
    swaToken?: string;
    staticWebAppHostname?: string;
    corsOrigin?: string;
  };
  appSettings: Record<string, string>;
  /** For full-stack / SWA modes — ID of the backend App Service instance to push settings to */
  backendInstanceId?: string;
  /** Subscription ID of the backend App Service (needed for app settings push) */
  backendSubscriptionId?: string;
}

export interface DeploySetupResult {
  branchCreated: boolean;
  branchName: string;
  pipelineUpdated: boolean;
  apiConfigUpdated: boolean;
  appSettingsUpdated: boolean;
  appSettingsError?: string;
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { credentials: "include", ...options });
}

export const deploySetupService = {
  listAdoRepos: async (): Promise<{ repos: AdoRepo[] }> => {
    const res = await apiFetch(getApiUrl("/api/provisioning/ado-repos"));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to list repos: ${res.status}`);
    }
    return res.json();
  },

  listAdoBranches: async (repoId: string): Promise<{ branches: AdoBranch[] }> => {
    const res = await apiFetch(getApiUrl(`/api/provisioning/ado-repos/${repoId}/branches`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to list branches: ${res.status}`);
    }
    return res.json();
  },

  registerRedirectUri: async (redirectUri: string, appClientId: string): Promise<{ added: boolean }> => {
    const res = await apiFetch(getApiUrl("/api/provisioning/register-redirect-uri"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUri, appClientId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to register redirect URI: ${res.status}`);
    }
    return res.json();
  },

  fetchSwaToken: async (instanceId: string, armToken: string): Promise<string> => {
    const res = await apiFetch(getApiUrl(`/api/instances/${instanceId}/swa-token`), {
      method: "POST",
      headers: { "x-azure-token": armToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to fetch SWA token: ${res.status}`);
    }
    const data = await res.json();
    return data.token;
  },

  setupDeployment: async (
    instanceId: string,
    payload: DeploySetupPayload,
    armToken?: string | null
  ): Promise<DeploySetupResult> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (armToken) headers["x-azure-token"] = armToken;

    const res = await apiFetch(getApiUrl(`/api/instances/${instanceId}/setup-deployment`), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to setup deployment: ${res.status}`);
    }
    return res.json();
  },
};
