import { SubscriptionClient } from '@azure/arm-subscriptions';
import { ResourceManagementClient } from '@azure/arm-resources';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { SqlManagementClient } from '@azure/arm-sql';
import { PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { MySQLManagementFlexibleServerClient } from '@azure/arm-mysql-flexible';
import { DefaultAzureCredential } from '@azure/identity';
import type { TokenCredential, AccessToken } from '@azure/core-auth';

/** Wraps a user's OAuth access token as a TokenCredential for Azure SDK clients. */
class BearerTokenCredential implements TokenCredential {
  constructor(private token: string) {}
  async getToken(): Promise<AccessToken> {
    return { token: this.token, expiresOnTimestamp: Date.now() + 3600 * 1000 };
  }
}

export interface UserAzureContext {
  subscriptions: AzureSubscription[];
  defaultSubscription?: AzureSubscription;
}

export interface AzureSubscription {
  id: string;
  displayName: string;
  state: string;
  tenantId: string;
}

export interface AzureResourceGroup {
  name: string;
  location: string;
  id: string;
}

/** Determines which Azure resource type to create based on runtime/serviceType. */
function isStaticWebApp(runtime: string, serviceType: string): boolean {
  return runtime === 'Static Web App' || serviceType === 'Static Site';
}

function isDatabase(serviceType: string): boolean {
  return serviceType === 'Database';
}

export class UserAzureService {
  private subscriptionClient: SubscriptionClient;
  private credential: TokenCredential;
  private tenantId: string;
  private rawToken: string | undefined;

  constructor(accessToken?: string, tenantId?: string) {
    this.tenantId = tenantId || process.env.AZURE_TENANT_ID || '';

    if (accessToken) {
      console.log('[UserAzureService] Initializing with user OAuth token...');
      this.rawToken = accessToken;
      this.credential = new BearerTokenCredential(accessToken);
    } else {
      console.log('[UserAzureService] Initializing with DefaultAzureCredential...');
      if (!process.env.AZURE_TENANT_ID && !tenantId) {
        throw new Error('Azure auth not configured. Provide AZURE_TENANT_ID or sign in.');
      }
      this.credential = new DefaultAzureCredential();
    }

    this.subscriptionClient = new SubscriptionClient(this.credential);
  }

  /**
   * Get all subscriptions accessible to the user
   */
  async getUserSubscriptions(): Promise<AzureSubscription[]> {
    const subscriptions: AzureSubscription[] = [];

    try {
      for await (const subscription of this.subscriptionClient.subscriptions.list()) {
        if (subscription.subscriptionId && subscription.displayName) {
          subscriptions.push({
            id: subscription.subscriptionId,
            displayName: subscription.displayName,
            state: subscription.state || 'Unknown',
            tenantId: subscription.tenantId || this.tenantId,
          });
        }
      }
    } catch (error: any) {
      console.error('[UserAzureService] Error fetching subscriptions:', error);
      throw new Error(`Failed to fetch subscriptions: ${error.message}`);
    }

    return subscriptions;
  }

  /**
   * Get resource groups for a specific subscription
   */
  async getResourceGroups(subscriptionId: string): Promise<AzureResourceGroup[]> {
    const resourceClient = new ResourceManagementClient(this.credential, subscriptionId);
    const resourceGroups: AzureResourceGroup[] = [];

    try {
      for await (const rg of resourceClient.resourceGroups.list()) {
        if (rg.name && rg.location && rg.id) {
          resourceGroups.push({
            name: rg.name,
            location: rg.location,
            id: rg.id,
          });
        }
      }
    } catch (error: any) {
      console.error('[UserAzureService] Error fetching resource groups:', error);
      throw new Error(`Failed to fetch resource groups: ${error.message}`);
    }

    return resourceGroups;
  }

  /**
   * Create a new Azure resource group in a subscription.
   */
  async createResourceGroup(subscriptionId: string, name: string, location: string): Promise<AzureResourceGroup> {
    const resourceClient = new ResourceManagementClient(this.credential, subscriptionId);
    try {
      const result = await resourceClient.resourceGroups.createOrUpdate(name, { location });
      return {
        name: result.name!,
        location: result.location!,
        id: result.id!,
      };
    } catch (error: any) {
      console.error('[UserAzureService] Error creating resource group:', error);
      throw new Error(`Failed to create resource group: ${error.message}`);
    }
  }

  /**
   * Create an Azure instance — routes to Static Web App or App Service based on runtime/serviceType.
   */
  async createUserInstance(
    subscriptionId: string,
    resourceGroupName: string,
    payload: any,
    instanceId: string
  ) {
    console.log(`[UserAzureService] Creating instance ${payload.instanceName} (${payload.runtime}) in subscription ${subscriptionId}`);
    console.log(`[UserAzureService] Resource Group: ${resourceGroupName}, Region: ${payload.region}`);

    const webSiteClient = new WebSiteManagementClient(this.credential, subscriptionId);
    const resourceClient = new ResourceManagementClient(this.credential, subscriptionId);

    // Ensure resource group exists for both paths
    await this.ensureResourceGroupExists(resourceClient, resourceGroupName, payload.region);

    if (isDatabase(payload.serviceType)) {
      return this.createDatabase(resourceClient, resourceGroupName, payload, instanceId, subscriptionId);
    } else if (isStaticWebApp(payload.runtime, payload.serviceType)) {
      return this.createStaticWebApp(webSiteClient, resourceGroupName, payload, instanceId, subscriptionId);
    } else {
      return this.createAppService(webSiteClient, resourceGroupName, payload, instanceId, subscriptionId);
    }
  }

  // ─── Static Web App ───────────────────────────────────────────────────────

  private async createStaticWebApp(
    webSiteClient: WebSiteManagementClient,
    resourceGroupName: string,
    payload: any,
    instanceId: string,
    subscriptionId: string
  ) {
    const siteName = `${payload.instanceName}-${instanceId.slice(0, 8)}`;
    // Static Web Apps only support a subset of regions — map to nearest supported
    const staticSiteRegionMap: Record<string, string> = {
      eastus:         'East US 2',
      eastus2:        'East US 2',
      westus:         'West US 2',
      westus2:        'West US 2',
      centralus:      'Central US',
      northcentralus: 'Central US',
      southcentralus: 'Central US',
      westcentralus:  'West US 2',
      canadacentral:  'East US 2',
      canadaeast:     'East US 2',
      westeurope:     'West Europe',
      eastasia:       'East Asia',
    };
    const location = staticSiteRegionMap[payload.region] || 'East US 2';
    console.log(`[UserAzureService] Static Web App region: ${payload.region} → ${location}`);

    console.log(`[UserAzureService] Creating Static Web App: ${siteName}`);

    try {
      const result = await webSiteClient.staticSites.beginCreateOrUpdateStaticSiteAndWait(
        resourceGroupName,
        siteName,
        {
          location,
          sku: { name: 'Free', tier: 'Free' },
          // repositoryUrl and branch are required by the API even for detached (no-repo) static sites
          repositoryUrl: '',
          branch: '',
          buildProperties: {},
          tags: {
            environment: payload.environment.toLowerCase(),
            createdBy: 'DevX-Platform',
            createdFor: 'user-provisioning',
            ...(payload.advancedSettings?.autoDeleteDays ? {
              autoDeleteAfter: new Date(
                Date.now() + payload.advancedSettings.autoDeleteDays * 24 * 60 * 60 * 1000
              ).toISOString(),
            } : {}),
            ...this.parseTags(payload.advancedSettings?.tags),
          },
        }
      );

      const url = result.defaultHostname
        ? `https://${result.defaultHostname}`
        : `https://${siteName}.azurestaticapps.net`;

      console.log(`[UserAzureService] Static Web App created: ${url}`);

      return {
        success: true,
        instanceId,
        url,
        resourceGroupName,
        appServiceName: siteName,
        appServicePlanName: null,
        subscriptionId,
      };
    } catch (error: any) {
      console.error('[UserAzureService] CRITICAL ERROR creating Static Web App:', error);
      return {
        success: false,
        instanceId,
        errorMessage: `Azure provisioning failed: ${error.message}. Check Azure permissions.`,
        resourceGroupName,
        appServiceName: siteName,
        appServicePlanName: null,
        subscriptionId,
      };
    }
  }

  // ─── App Service (Web App / API) ──────────────────────────────────────────

  private async createAppService(
    webSiteClient: WebSiteManagementClient,
    resourceGroupName: string,
    payload: any,
    instanceId: string,
    subscriptionId: string
  ) {
    const appServiceName = `${payload.instanceName}-${instanceId.slice(0, 8)}`;
    const appServicePlanName = `${appServiceName}-plan`;

    console.log(`[UserAzureService] Creating App Service: ${appServiceName}`);

    try {
      // Step 1: Create App Service Plan
      console.log(`[UserAzureService] Creating App Service Plan: ${appServicePlanName}`);
      const appServicePlan = await webSiteClient.appServicePlans.beginCreateOrUpdateAndWait(
        resourceGroupName,
        appServicePlanName,
        {
          location: this.mapRegionToLocation(payload.region),
          sku: this.getSkuForPlanTier(payload.planTier),
          kind: 'linux',
          reserved: true,
        }
      );
      console.log(`[UserAzureService] App Service Plan created: ${appServicePlan.id}`);

      // Step 2: Brief wait for plan to be fully available
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 3: Verify plan exists
      await webSiteClient.appServicePlans.get(resourceGroupName, appServicePlanName);

      // Step 4: Create Web App
      const runtimeConfig = this.getRuntimeConfig(payload.runtime);

      const appSettings = [
        { name: 'NODE_ENV', value: payload.environment.toLowerCase() },
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' },
        { name: 'WEBSITES_PORT', value: '3000' },
      ];

      const webAppConfig: any = {
        location: this.mapRegionToLocation(payload.region),
        serverFarmId: appServicePlan.id!,
        siteConfig: {
          appSettings,
          ...(payload.frontendUrl ? {
            cors: {
              allowedOrigins: [payload.frontendUrl],
              supportCredentials: true,
            },
          } : {}),
          ...runtimeConfig,
        },
        tags: {
          environment: payload.environment.toLowerCase(),
          createdBy: 'DevX-Platform',
          createdFor: 'user-provisioning',
          ...(payload.advancedSettings?.autoDeleteDays ? {
            autoDeleteAfter: new Date(
              Date.now() + payload.advancedSettings.autoDeleteDays * 24 * 60 * 60 * 1000
            ).toISOString(),
          } : {}),
          ...(this.parseTags(payload.advancedSettings?.tags)),
        },
      };

      console.log(`[UserAzureService] Creating Web App with runtime: ${payload.runtime}`);
      const appService = await webSiteClient.webApps.beginCreateOrUpdateAndWait(
        resourceGroupName,
        appServiceName,
        webAppConfig
      );
      console.log(`[UserAzureService] App Service created: ${appService.defaultHostName}`);

      return {
        success: true,
        instanceId,
        url: `https://${appServiceName}.azurewebsites.net`,
        resourceGroupName,
        appServiceName,
        appServicePlanName,
        subscriptionId,
      };
    } catch (error: any) {
      console.error('[UserAzureService] CRITICAL ERROR creating App Service:', error);
      console.error('[UserAzureService] Error details:', {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
      });
      return {
        success: false,
        instanceId,
        errorMessage: `Azure provisioning failed: ${error.message}. Check Azure permissions.`,
        resourceGroupName,
        appServiceName,
        appServicePlanName,
        subscriptionId,
      };
    }
  }

  // ─── Database ─────────────────────────────────────────────────────────────

  private async createDatabase(
    _resourceClient: ResourceManagementClient,
    resourceGroupName: string,
    payload: any,
    instanceId: string,
    subscriptionId: string
  ) {
    const db = payload.databaseConfig;
    if (!db) {
      return { success: false, instanceId, errorMessage: 'databaseConfig is required for Database service type', resourceGroupName, appServiceName: null, appServicePlanName: null, subscriptionId };
    }
    switch (db.engine) {
      case 'Azure SQL':
        return this.createAzureSqlDatabase(resourceGroupName, payload, instanceId, subscriptionId);
      case 'PostgreSQL Flexible':
        return this.createPostgresFlexibleDatabase(resourceGroupName, payload, instanceId, subscriptionId);
      case 'MySQL Flexible':
        return this.createMysqlFlexibleDatabase(resourceGroupName, payload, instanceId, subscriptionId);
      default:
        return { success: false, instanceId, errorMessage: `Unsupported database engine: ${db.engine}`, resourceGroupName, appServiceName: null, appServicePlanName: null, subscriptionId };
    }
  }

  private async createAzureSqlDatabase(
    resourceGroupName: string,
    payload: any,
    instanceId: string,
    subscriptionId: string
  ) {
    const db = payload.databaseConfig;
    const client = new SqlManagementClient(this.credential, subscriptionId);
    const location = this.mapRegionToLocation(payload.region);
    const skuMap: Record<string, string> = {
      Burstable: 'GP_S_Gen5_2',
      GeneralPurpose: 'GP_Gen5_2',
      MemoryOptimized: 'MO_Gen5_2',
    };
    const skuName = skuMap[db.skuTier] || 'GP_S_Gen5_2';

    try {
      if (db.serverMode === 'new') {
        console.log(`[UserAzureService] Creating Azure SQL Server: ${db.serverName}`);
        await client.servers.beginCreateOrUpdateAndWait(resourceGroupName, db.serverName, {
          location,
          administratorLogin: db.adminUsername,
          administratorLoginPassword: db.adminPassword,
          version: '12.0',
        });
        console.log(`[UserAzureService] Azure SQL Server created: ${db.serverName}`);
      }

      console.log(`[UserAzureService] Creating Azure SQL Database: ${db.databaseName}`);
      await client.databases.beginCreateOrUpdateAndWait(resourceGroupName, db.serverName, db.databaseName, {
        location,
        sku: { name: skuName },
        maxSizeBytes: db.storageSizeGb * 1024 * 1024 * 1024,
      });
      console.log(`[UserAzureService] Azure SQL Database created`);

      return {
        success: true,
        instanceId,
        url: `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Sql/servers/${db.serverName}/databases/${db.databaseName}`,
        resourceGroupName,
        appServiceName: null,
        appServicePlanName: null,
        subscriptionId,
        databaseServerName: db.serverName,
        databaseName: db.databaseName,
      };
    } catch (error: any) {
      console.error('[UserAzureService] Error creating Azure SQL Database:', error);
      return { success: false, instanceId, errorMessage: `Azure SQL provisioning failed: ${error.message}`, resourceGroupName, appServiceName: null, appServicePlanName: null, subscriptionId };
    }
  }

  private async createPostgresFlexibleDatabase(
    resourceGroupName: string,
    payload: any,
    instanceId: string,
    subscriptionId: string
  ) {
    const db = payload.databaseConfig;
    const client = new PostgreSQLManagementFlexibleServerClient(this.credential, subscriptionId);
    const location = this.mapRegionToLocation(payload.region);
    const skuMap: Record<string, { name: string; tier: string }> = {
      Burstable:        { name: 'Standard_B2ms',   tier: 'Burstable' },
      GeneralPurpose:   { name: 'Standard_D2s_v3', tier: 'GeneralPurpose' },
      MemoryOptimized:  { name: 'Standard_E2ds_v4', tier: 'MemoryOptimized' },
    };
    const sku = skuMap[db.skuTier] || skuMap.Burstable;

    try {
      if (db.serverMode === 'new') {
        console.log(`[UserAzureService] Creating PostgreSQL Flexible Server: ${db.serverName}`);
        await client.servers.beginCreateOrUpdateAndWait(resourceGroupName, db.serverName, {
          location,
          administratorLogin: db.adminUsername,
          administratorLoginPassword: db.adminPassword,
          sku,
          storage: { storageSizeGB: db.storageSizeGb },
          version: '15',
        });
        console.log(`[UserAzureService] PostgreSQL Flexible Server created: ${db.serverName}`);
      }

      console.log(`[UserAzureService] Creating PostgreSQL Database: ${db.databaseName}`);
      await client.databases.beginCreateAndWait(resourceGroupName, db.serverName, db.databaseName, {
        charset: 'UTF8',
        collation: 'en_US.utf8',
      });
      console.log(`[UserAzureService] PostgreSQL Database created`);

      return {
        success: true,
        instanceId,
        url: `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${db.serverName}/databases/${db.databaseName}`,
        resourceGroupName,
        appServiceName: null,
        appServicePlanName: null,
        subscriptionId,
        databaseServerName: db.serverName,
        databaseName: db.databaseName,
      };
    } catch (error: any) {
      console.error('[UserAzureService] Error creating PostgreSQL Flexible Database:', error);
      return { success: false, instanceId, errorMessage: `PostgreSQL provisioning failed: ${error.message}`, resourceGroupName, appServiceName: null, appServicePlanName: null, subscriptionId };
    }
  }

  private async createMysqlFlexibleDatabase(
    resourceGroupName: string,
    payload: any,
    instanceId: string,
    subscriptionId: string
  ) {
    const db = payload.databaseConfig;
    const client = new MySQLManagementFlexibleServerClient(this.credential, subscriptionId);
    const location = this.mapRegionToLocation(payload.region);
    const skuMap: Record<string, { name: string; tier: string }> = {
      Burstable:        { name: 'Standard_B2ms',   tier: 'Burstable' },
      GeneralPurpose:   { name: 'Standard_D2s_v3', tier: 'GeneralPurpose' },
      MemoryOptimized:  { name: 'Standard_E2ds_v4', tier: 'MemoryOptimized' },
    };
    const sku = skuMap[db.skuTier] || skuMap.Burstable;

    try {
      if (db.serverMode === 'new') {
        console.log(`[UserAzureService] Creating MySQL Flexible Server: ${db.serverName}`);
        await client.servers.beginCreateAndWait(resourceGroupName, db.serverName, {
          location,
          administratorLogin: db.adminUsername,
          administratorLoginPassword: db.adminPassword,
          sku,
          storage: { storageSizeGB: db.storageSizeGb },
          version: '8.0.21',
        });
        console.log(`[UserAzureService] MySQL Flexible Server created: ${db.serverName}`);
      }

      console.log(`[UserAzureService] Creating MySQL Database: ${db.databaseName}`);
      await client.databases.beginCreateOrUpdateAndWait(resourceGroupName, db.serverName, db.databaseName, {
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
      });
      console.log(`[UserAzureService] MySQL Database created`);

      return {
        success: true,
        instanceId,
        url: `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.DBforMySQL/flexibleServers/${db.serverName}/databases/${db.databaseName}`,
        resourceGroupName,
        appServiceName: null,
        appServicePlanName: null,
        subscriptionId,
        databaseServerName: db.serverName,
        databaseName: db.databaseName,
      };
    } catch (error: any) {
      console.error('[UserAzureService] Error creating MySQL Flexible Database:', error);
      return { success: false, instanceId, errorMessage: `MySQL provisioning failed: ${error.message}`, resourceGroupName, appServiceName: null, appServicePlanName: null, subscriptionId };
    }
  }

  /**
   * Update application settings (env vars) on an Azure App Service.
   * Merges new settings with existing ones (does not wipe existing settings).
   */
  async updateAppServiceSettings(
    subscriptionId: string,
    resourceGroupName: string,
    appServiceName: string,
    settings: Record<string, string>
  ): Promise<void> {
    // Sanitize: Azure only accepts valid identifier keys (no spaces, no "export " prefix, etc.)
    const validKeyRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const sanitized = Object.fromEntries(
      Object.entries(settings)
        .map(([k, v]) => [k.replace(/^export\s+/i, "").trim(), v])
        .filter(([k]) => validKeyRe.test(k as string))
    );

    const base = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroupName)}/providers/Microsoft.Web/sites/${encodeURIComponent(appServiceName)}/config/appsettings?api-version=2022-03-01`;

    // Use raw token for direct REST if available; fall back to SDK
    if (this.rawToken) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.rawToken}`,
        "Content-Type": "application/json",
      };

      // GET existing settings so we don't overwrite them
      const getRes = await fetch(base, { headers });
      const existing: Record<string, string> = getRes.ok
        ? ((await getRes.json()).properties as Record<string, string>) || {}
        : {};

      const merged = { ...existing, ...sanitized };

      const putRes = await fetch(base, {
        method: "PUT",
        headers,
        body: JSON.stringify({ properties: merged }),
      });

      if (!putRes.ok) {
        const errBody = await putRes.text();
        throw new Error(`Failed to update app settings (${putRes.status}): ${errBody}`);
      }

      console.log(`[UserAzureService] Updated app settings for ${appServiceName} via REST: merged ${Object.keys(existing).length} existing + ${Object.keys(sanitized).length} new settings`);
      return;
    }

    // Fallback: SDK (replaces all settings — only used when no raw token)
    const webSiteClient = new WebSiteManagementClient(this.credential, subscriptionId);
    await webSiteClient.webApps.updateApplicationSettings(resourceGroupName, appServiceName, {
      properties: sanitized,
    });
    console.log(`[UserAzureService] Updated app settings for ${appServiceName} via SDK: ${Object.keys(sanitized).join(', ')}`);
  }

  /**
   * Fetch the deployment token (apiKey) for an Azure Static Web App.
   */
  async getSwaDeploymentToken(
    subscriptionId: string,
    resourceGroupName: string,
    staticSiteName: string
  ): Promise<string> {
    if (!this.rawToken) throw new Error("ARM token required to fetch SWA deployment token");

    const url = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroupName)}/providers/Microsoft.Web/staticSites/${encodeURIComponent(staticSiteName)}/listSecrets?api-version=2022-03-01`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.rawToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to fetch SWA token (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const token = data.properties?.apiKey ?? "";
    if (!token) throw new Error("SWA deployment token not found in response");
    return token;
  }

  /**
   * Update CORS settings on an Azure App Service.
   * Enables Access-Control-Allow-Credentials and sets the allowed origins.
   */
  async updateAppServiceCors(
    subscriptionId: string,
    resourceGroupName: string,
    appServiceName: string,
    allowedOrigins: string[]
  ): Promise<void> {
    const base = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroupName)}/providers/Microsoft.Web/sites/${encodeURIComponent(appServiceName)}/config/web?api-version=2022-03-01`;

    if (!this.rawToken) {
      throw new Error("ARM token required to update CORS settings");
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.rawToken}`,
      "Content-Type": "application/json",
    };

    // GET existing web config to avoid overwriting other settings
    const getRes = await fetch(base, { headers });
    const existing = getRes.ok ? await getRes.json() : {};

    const body = {
      ...existing,
      properties: {
        ...(existing.properties ?? {}),
        cors: {
          allowedOrigins,
          supportCredentials: true,
        },
      },
    };

    const putRes = await fetch(base, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });

    if (!putRes.ok) {
      const errBody = await putRes.text();
      throw new Error(`Failed to update CORS (${putRes.status}): ${errBody}`);
    }

    console.log(`[UserAzureService] Updated CORS for ${appServiceName}: allowedOrigins=${allowedOrigins.join(", ")}, supportCredentials=true`);
  }

  /**
   * Delete an Azure instance — handles App Service, Static Web App, and Database resources.
   */
  async deleteUserInstance(instance: {
    serviceType: string;
    subscriptionId: string;
    resourceGroupName: string;
    appServiceName?: string | null;
    appServicePlanName?: string | null;
    databaseEngine?: string | null;
    databaseServerName?: string | null;
    databaseName?: string | null;
  }): Promise<boolean> {
    const { subscriptionId, resourceGroupName } = instance;

    try {
      if (isDatabase(instance.serviceType)) {
        return this.deleteDatabaseResources(subscriptionId, resourceGroupName, instance);
      } else if (instance.serviceType === 'Static Site') {
        const webSiteClient = new WebSiteManagementClient(this.credential, subscriptionId);
        if (instance.appServiceName) {
          await webSiteClient.staticSites.beginDeleteStaticSiteAndWait(resourceGroupName, instance.appServiceName);
          console.log(`[UserAzureService] Deleted Static Web App: ${instance.appServiceName}`);
        }
        return true;
      } else {
        const webSiteClient = new WebSiteManagementClient(this.credential, subscriptionId);
        if (instance.appServiceName) {
          await webSiteClient.webApps.delete(resourceGroupName, instance.appServiceName);
          console.log(`[UserAzureService] Deleted Web App: ${instance.appServiceName}`);
        }
        if (instance.appServicePlanName) {
          await webSiteClient.appServicePlans.delete(resourceGroupName, instance.appServicePlanName);
          console.log(`[UserAzureService] Deleted App Service Plan: ${instance.appServicePlanName}`);
        }
        return true;
      }
    } catch (error: any) {
      console.error('[UserAzureService] Error deleting instance:', error);
      return false;
    }
  }

  private async deleteDatabaseResources(
    subscriptionId: string,
    resourceGroupName: string,
    instance: { databaseEngine?: string | null; databaseServerName?: string | null; databaseName?: string | null }
  ): Promise<boolean> {
    const { databaseEngine, databaseServerName, databaseName } = instance;
    if (!databaseServerName || !databaseName) return false;

    try {
      if (databaseEngine === 'Azure SQL') {
        const client = new SqlManagementClient(this.credential, subscriptionId);
        await client.databases.beginDeleteAndWait(resourceGroupName, databaseServerName, databaseName);
        console.log(`[UserAzureService] Deleted Azure SQL Database: ${databaseName}`);
      } else if (databaseEngine === 'PostgreSQL Flexible') {
        const client = new PostgreSQLManagementFlexibleServerClient(this.credential, subscriptionId);
        await client.databases.beginDeleteAndWait(resourceGroupName, databaseServerName, databaseName);
        console.log(`[UserAzureService] Deleted PostgreSQL Database: ${databaseName}`);
      } else if (databaseEngine === 'MySQL Flexible') {
        const client = new MySQLManagementFlexibleServerClient(this.credential, subscriptionId);
        await client.databases.beginDeleteAndWait(resourceGroupName, databaseServerName, databaseName);
        console.log(`[UserAzureService] Deleted MySQL Database: ${databaseName}`);
      }
      return true;
    } catch (error: any) {
      console.error('[UserAzureService] Error deleting database resources:', error);
      return false;
    }
  }

  /**
   * List existing database servers in a resource group, filtered by engine type.
   */
  async listDatabaseServers(
    engine: string,
    subscriptionId: string,
    resourceGroupName: string
  ): Promise<Array<{ name: string; location: string; fullyQualifiedDomainName?: string }>> {
    const servers: Array<{ name: string; location: string; fullyQualifiedDomainName?: string }> = [];
    try {
      if (engine === 'Azure SQL') {
        const client = new SqlManagementClient(this.credential, subscriptionId);
        for await (const s of client.servers.listByResourceGroup(resourceGroupName)) {
          if (s.name) servers.push({ name: s.name, location: s.location || '', fullyQualifiedDomainName: s.fullyQualifiedDomainName });
        }
      } else if (engine === 'PostgreSQL Flexible') {
        const client = new PostgreSQLManagementFlexibleServerClient(this.credential, subscriptionId);
        for await (const s of client.servers.listByResourceGroup(resourceGroupName)) {
          if (s.name) servers.push({ name: s.name, location: s.location || '', fullyQualifiedDomainName: s.fullyQualifiedDomainName });
        }
      } else if (engine === 'MySQL Flexible') {
        const client = new MySQLManagementFlexibleServerClient(this.credential, subscriptionId);
        for await (const s of client.servers.listByResourceGroup(resourceGroupName)) {
          if (s.name) servers.push({ name: s.name, location: s.location || '', fullyQualifiedDomainName: s.fullyQualifiedDomainName });
        }
      }
    } catch (error: any) {
      console.error('[UserAzureService] Error listing database servers:', error);
      throw new Error(`Failed to list database servers: ${error.message}`);
    }
    return servers;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async ensureResourceGroupExists(
    resourceClient: ResourceManagementClient,
    resourceGroupName: string,
    region: string
  ) {
    try {
      await resourceClient.resourceGroups.get(resourceGroupName);
      console.log(`[UserAzureService] Resource group ${resourceGroupName} already exists`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`[UserAzureService] Creating resource group ${resourceGroupName}...`);
        await resourceClient.resourceGroups.createOrUpdate(resourceGroupName, {
          location: this.mapRegionToLocation(region),
          tags: { createdBy: 'DevX-Platform', createdFor: 'user-provisioning' },
        });
      } else {
        throw error;
      }
    }
  }

  private getSkuForPlanTier(planTier: string): { name: string; tier: string; capacity?: number } {
    const skuMap: Record<string, { name: string; tier: string; capacity?: number }> = {
      'Free (F1)':      { name: 'F1',    tier: 'Free' },
      'Basic (B1)':     { name: 'B1',    tier: 'Basic',    capacity: 1 },
      'Basic (B2)':     { name: 'B2',    tier: 'Basic',    capacity: 1 },
      'Standard (S1)':  { name: 'S1',    tier: 'Standard', capacity: 1 },
      'Standard (S2)':  { name: 'S2',    tier: 'Standard', capacity: 1 },
      'Premium (P1v3)': { name: 'P1v3',  tier: 'PremiumV3', capacity: 1 },
    };
    return skuMap[planTier] || skuMap['Basic (B1)'];
  }

  private getRuntimeConfig(runtime: string): any {
    const runtimeMap: Record<string, any> = {
      'Node 20 LTS':  { linuxFxVersion: 'NODE|20-lts' },
      'Node 18 LTS':  { linuxFxVersion: 'NODE|18-lts' },
      'Python 3.11':  { linuxFxVersion: 'PYTHON|3.11' },
      '.NET 8':       { linuxFxVersion: 'DOTNETCORE|8.0' },
      'PHP 8.2':      { linuxFxVersion: 'PHP|8.2' },
      'Java 17':      { linuxFxVersion: 'JAVA|17-java17', javaVersion: '17', javaContainer: 'JAVA', javaContainerVersion: 'SE' },
    };
    return runtimeMap[runtime] || runtimeMap['Node 20 LTS'];
  }

  private parseTags(tags?: Array<{ key: string; value: string }>): Record<string, string> {
    if (!tags?.length) return {};
    return Object.fromEntries(tags.filter(t => t.key).map(t => [t.key, t.value]));
  }

  private mapRegionToLocation(region: string): string {
    const regionMap: Record<string, string> = {
      canadacentral:  'Canada Central',
      canadaeast:     'Canada East',
      eastus:         'East US',
      eastus2:        'East US 2',
      westus:         'West US',
      westus2:        'West US 2',
      centralus:      'Central US',
      southcentralus: 'South Central US',
      northcentralus: 'North Central US',
      westcentralus:  'West Central US',
      westeurope:     'West Europe',
      eastasia:       'East Asia',
    };
    return regionMap[region] || 'East US';
  }
}

export function createUserAzureService(accessToken?: string, tenantId?: string): UserAzureService {
  return new UserAzureService(accessToken, tenantId);
}
