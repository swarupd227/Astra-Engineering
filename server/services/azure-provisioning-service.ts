import { WebSiteManagementClient } from '@azure/arm-appservice';
import { ResourceManagementClient } from '@azure/arm-resources';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import type { CreateInstancePayload, ProvisionInstanceResponse } from "@shared/types/provisioning.types";

export interface AzureConfig {
  subscriptionId: string;
  tenantId: string;
  clientId?: string;
  clientSecret?: string;
  resourceGroupName: string;
  location: string;
}

export interface ProvisioningResult {
  success: boolean;
  instanceId: string;
  url?: string;
  errorMessage?: string;
  resourceGroupName: string;
  appServiceName: string;
  appServicePlanName: string;
}

export class AzureProvisioningService {
  private webSiteClient: WebSiteManagementClient;
  private resourceClient: ResourceManagementClient;
  private config: AzureConfig;

  constructor(config: AzureConfig) {
    this.config = config;

    // Use service principal credentials if provided, otherwise use default credential
    const credential = config.clientId && config.clientSecret 
      ? new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret)
      : new DefaultAzureCredential();

    this.webSiteClient = new WebSiteManagementClient(credential, config.subscriptionId);
    this.resourceClient = new ResourceManagementClient(credential, config.subscriptionId);
  }

  /**
   * Create a complete Azure App Service instance
   */
  async createInstance(payload: CreateInstancePayload, instanceId: string): Promise<ProvisioningResult> {
    const appServiceName = `${payload.instanceName}-${instanceId.slice(0, 8)}`;
    const appServicePlanName = `${appServiceName}-plan`;

    try {
      // 1. Ensure resource group exists
      await this.ensureResourceGroup();

      // 2. Create App Service Plan
      const appServicePlan = await this.createAppServicePlan(
        appServicePlanName,
        payload.region,
        payload.planTier
      );

      if (!appServicePlan.id) {
        throw new Error("Failed to create App Service Plan - no ID returned");
      }

      // 3. Create App Service (Web App)
      const appService = await this.createAppService(
        appServiceName,
        appServicePlan.id,
        payload.runtime,
        payload.environment,
        payload.advancedSettings
      );

      // 4. Configure app settings if needed
      if (payload.advancedSettings.enableLogging) {
        await this.configureLogging(appServiceName);
      }

      // 5. Apply tags
      if (payload.advancedSettings.tags.length > 0) {
        await this.applyTags(appServiceName, payload.advancedSettings.tags);
      }

      return {
        success: true,
        instanceId,
        url: `https://${appServiceName}.azurewebsites.net`,
        resourceGroupName: this.config.resourceGroupName,
        appServiceName,
        appServicePlanName
      };

    } catch (error: any) {
      console.error("[Azure Provisioning] Error creating instance:", error);
      return {
        success: false,
        instanceId,
        errorMessage: error.message || "Unknown provisioning error",
        resourceGroupName: this.config.resourceGroupName,
        appServiceName,
        appServicePlanName
      };
    }
  }

  /**
   * Delete an Azure App Service instance and its plan
   */
  async deleteInstance(appServiceName: string, appServicePlanName: string): Promise<boolean> {
    try {
      // Delete App Service first
      await this.webSiteClient.webApps.delete(
        this.config.resourceGroupName,
        appServiceName
      );

      // Then delete App Service Plan if no other apps are using it
      const appsInPlan = await this.webSiteClient.appServicePlans.listWebAppsByAppServicePlan(
        this.config.resourceGroupName,
        appServicePlanName
      );

      // Convert async iterator to array to check length
      const apps = [];
      for await (const app of appsInPlan) {
        apps.push(app);
      }

      if (apps.length === 0) {
        await this.webSiteClient.appServicePlans.delete(
          this.config.resourceGroupName,
          appServicePlanName
        );
      }

      return true;
    } catch (error: any) {
      console.error("[Azure Provisioning] Error deleting instance:", error);
      return false;
    }
  }

  /**
   * Get the status of an App Service
   */
  async getInstanceStatus(appServiceName: string): Promise<'running' | 'stopped' | 'error' | 'not-found'> {
    try {
      const webApp = await this.webSiteClient.webApps.get(
        this.config.resourceGroupName,
        appServiceName
      );

      return webApp.state === 'Running' ? 'running' : 'stopped';
    } catch (error: any) {
      if (error.statusCode === 404) {
        return 'not-found';
      }
      console.error("[Azure Provisioning] Error getting instance status:", error);
      return 'error';
    }
  }

  private async ensureResourceGroup(): Promise<void> {
    try {
      await this.resourceClient.resourceGroups.get(this.config.resourceGroupName);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create resource group if it doesn't exist
        await this.resourceClient.resourceGroups.createOrUpdate(
          this.config.resourceGroupName,
          {
            location: this.config.location,
            tags: {
              createdBy: 'DevX-Platform',
              environment: 'managed'
            }
          }
        );
      } else {
        throw error;
      }
    }
  }

  private async createAppServicePlan(
    planName: string,
    location: string,
    planTier: string
  ) {
    const skuMap: Record<string, { name: string; tier: string; capacity?: number }> = {
      "Basic (B1)": { name: "B1", tier: "Basic", capacity: 1 },
      "Standard (S1)": { name: "S1", tier: "Standard", capacity: 1 }
    };

    const sku = skuMap[planTier] || skuMap["Basic (B1)"];

    return await this.webSiteClient.appServicePlans.beginCreateOrUpdateAndWait(
      this.config.resourceGroupName,
      planName,
      {
        location: this.mapRegionToLocation(location),
        sku: sku,
        kind: 'app'
      }
    );
  }

  private async createAppService(
    appName: string,
    serverFarmId: string,
    runtime: string,
    environment: string,
    advancedSettings: any
  ) {
    const runtimeConfig = this.getRuntimeConfig(runtime);

    const webAppConfig: any = {
      location: this.config.location,
      serverFarmId: serverFarmId,
      siteConfig: {
        appSettings: [
          {
            name: "WEBSITES_ENABLE_APP_SERVICE_STORAGE",
            value: "false"
          },
          {
            name: "WEBSITES_PORT",
            value: "3000"
          },
          {
            name: "NODE_ENV",
            value: environment.toLowerCase()
          }
        ],
        ...runtimeConfig
      },
      tags: {
        environment: environment.toLowerCase(),
        createdBy: 'DevX-Platform'
      }
    };

    // Add auto-delete configuration if specified
    if (advancedSettings.autoDeleteDays) {
      webAppConfig.tags.autoDeleteAfter = new Date(
        Date.now() + advancedSettings.autoDeleteDays * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    return await this.webSiteClient.webApps.beginCreateOrUpdateAndWait(
      this.config.resourceGroupName,
      appName,
      webAppConfig
    );
  }

  private async configureLogging(appServiceName: string): Promise<void> {
    await this.webSiteClient.webApps.updateDiagnosticLogsConfig(
      this.config.resourceGroupName,
      appServiceName,
      {
        applicationLogs: {
          fileSystem: {
            level: 'Information'
          }
        },
        httpLogs: {
          fileSystem: {
            retentionInMb: 35,
            retentionInDays: 7,
            enabled: true
          }
        },
        failedRequestsTracing: {
          enabled: true
        },
        detailedErrorMessages: {
          enabled: true
        }
      }
    );
  }

  private async applyTags(appServiceName: string, tags: Array<{key: string, value: string}>): Promise<void> {
    const webApp = await this.webSiteClient.webApps.get(
      this.config.resourceGroupName,
      appServiceName
    );

    const newTags = { ...webApp.tags };
    tags.forEach(tag => {
      if (tag.key && tag.value) {
        newTags[tag.key] = tag.value;
      }
    });

    await this.webSiteClient.webApps.update(
      this.config.resourceGroupName,
      appServiceName,
      {
        tags: newTags
      }
    );
  }

  private getRuntimeConfig(runtime: string): any {
    const runtimeMap: Record<string, any> = {
      "Node 20 LTS": {
        linuxFxVersion: "NODE|20-lts",
        nodeVersion: "~20"
      }
    };

    return runtimeMap[runtime] || runtimeMap["Node 20 LTS"];
  }

  private mapRegionToLocation(region: string): string {
    const regionMap: Record<string, string> = {
      "canadacentral": "Canada Central",
      "eastus": "East US",
      "westus": "West US"
    };

    return regionMap[region] || "East US";
  }
}

/**
* Factory function to create Azure provisioning service with environment config
*/
export function createAzureProvisioningService(): AzureProvisioningService {
  const config: AzureConfig = {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
    tenantId: process.env.AZURE_TENANT_ID!,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    resourceGroupName: process.env.AZURE_RESOURCE_GROUP || 'devx-instances',
    location: process.env.AZURE_DEFAULT_LOCATION || 'East US'
  };

  // Validate required config
  if (!config.subscriptionId) {
    throw new Error("AZURE_SUBSCRIPTION_ID environment variable is required");
  }
  if (!config.tenantId) {
    throw new Error("AZURE_TENANT_ID environment variable is required");
  }

  return new AzureProvisioningService(config);
}
