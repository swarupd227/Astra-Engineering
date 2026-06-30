import { apiRequest } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import type {
  CreateInstancePayload,
  ProvisionInstanceResponse,
  ListInstancesResponse,
  UserAzureContext,
  AzureResourceGroup,
} from "@shared/types/provisioning.types";

export const provisioningService = {
  /**
   * Gets user's Azure subscriptions
   * @returns Promise containing user's accessible subscriptions
   */
  getUserSubscriptions: async (armToken: string): Promise<UserAzureContext> => {
    const response = await fetch(getApiUrl("/api/azure/subscriptions"), {
      credentials: "include",
      headers: { "x-azure-token": armToken },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch subscriptions: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Gets resource groups for a subscription
   * @param subscriptionId - The Azure subscription ID
   * @param armToken - Azure Management access token
   * @returns Promise containing list of resource groups
   */
  getResourceGroups: async (subscriptionId: string, armToken: string): Promise<{ resourceGroups: AzureResourceGroup[] }> => {
    const response = await fetch(getApiUrl(`/api/azure/subscriptions/${subscriptionId}/resource-groups`), {
      credentials: "include",
      headers: { "x-azure-token": armToken },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch resource groups: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Creates a new resource group in a subscription
   */
  createResourceGroup: async (
    subscriptionId: string,
    name: string,
    location: string,
    armToken: string
  ): Promise<{ resourceGroup: AzureResourceGroup }> => {
    const response = await fetch(getApiUrl(`/api/azure/subscriptions/${subscriptionId}/resource-groups`), {
      method: "POST",
      credentials: "include",
      headers: { "x-azure-token": armToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, location }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to create resource group: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Lists existing database servers in a resource group filtered by engine
   */
  listDatabaseServers: async (
    subscriptionId: string,
    resourceGroupName: string,
    engine: string,
    armToken: string
  ): Promise<{ servers: Array<{ name: string; location: string; fullyQualifiedDomainName?: string }> }> => {
    const params = new URLSearchParams({ engine });
    const response = await fetch(
      getApiUrl(`/api/azure/subscriptions/${subscriptionId}/resource-groups/${resourceGroupName}/database-servers?${params}`),
      {
        credentials: "include",
        headers: { "x-azure-token": armToken },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch database servers: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Creates a new infrastructure instance
   * @param payload - The provisioning configuration
   * @returns Promise containing the provisioned instance details
   */
  createInstance: async (payload: CreateInstancePayload, armToken?: string): Promise<ProvisionInstanceResponse> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (armToken) headers["x-azure-token"] = armToken;

    const response = await fetch(getApiUrl("/api/instances"), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to create instance: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Lists all instances for the current user
   * @returns Promise containing the list of instances
   */
  listInstances: async (): Promise<ListInstancesResponse> => {
    const response = await apiRequest("GET", "/api/instances");

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to list instances: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Gets details for a specific instance
   * @param instanceId - The ID of the instance
   * @returns Promise containing the instance details
   */
  getInstance: async (instanceId: string): Promise<ProvisionInstanceResponse> => {
    const response = await apiRequest("GET", `/api/instances/${instanceId}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to get instance: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Deletes an instance
   * @param instanceId - The ID of the instance to delete
   * @returns Promise containing deletion confirmation
   */
  deleteInstance: async (instanceId: string, armToken?: string): Promise<{ message: string; instanceId: string }> => {
    const headers: Record<string, string> = {};
    if (armToken) headers["x-azure-token"] = armToken;

    const response = await fetch(getApiUrl(`/api/instances/${instanceId}`), {
      method: "DELETE",
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to delete instance: ${response.status}`);
    }

    return response.json();
  },
};
