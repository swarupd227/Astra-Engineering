export type EnvironmentType = "Development" | "QA" | "Production";

export type RegionType = "canadacentral" | "eastus" | "eastus2" | "westus" | "westus2" | "centralus" | "westeurope" | "eastasia";

export type RuntimeType = 
  | "Node 20 LTS"          // Web applications, APIs, SPAs
  | "Node 18 LTS"          // Legacy Node.js apps  
  | "Python 3.11"          // Python web apps, data apps
  | ".NET 8"               // .NET web apps, APIs
  | "PHP 8.2"              // PHP applications
  | "Java 17"              // Java Spring Boot apps
  | "Static Web App"       // HTML/CSS/JS static sites;

export type ServiceType =
  | "Web App"              // Traditional web applications
  | "API"                  // REST APIs and microservices
  | "Static Site"          // Static HTML/CSS/JS sites
  | "Database"             // Database instances
  | "Function App"         // Serverless functions (future);

export type DatabaseEngineType = "Azure SQL" | "PostgreSQL Flexible" | "MySQL Flexible";
export type DatabaseServerMode = "new" | "existing";
export type DatabaseSkuTier = "Burstable" | "GeneralPurpose" | "MemoryOptimized";

export type PlanTierType = 
  | "Free (F1)"            // Free tier for learning/testing
  | "Basic (B1)"           // Small production workloads
  | "Basic (B2)"           // Medium production workloads  
  | "Standard (S1)"        // Auto-scale, custom domains
  | "Standard (S2)"        // Higher performance
  | "Premium (P1v3)"       // High-performance production;

export interface TagPair {
  key: string;
  value: string;
}

export interface DatabaseConfig {
  engine: DatabaseEngineType;
  serverMode: DatabaseServerMode;
  serverName: string;         // new server name, or existing server name
  adminUsername: string;      // required for new server
  adminPassword: string;      // required for new server
  databaseName: string;
  skuTier: DatabaseSkuTier;
  storageSizeGb: number;      // 32 | 64 | 128 | 256 | 512
}

export interface CreateInstancePayload {
  instanceName: string;
  environment: EnvironmentType;
  region: RegionType;
  serviceType: ServiceType;
  runtime?: RuntimeType;
  planTier?: PlanTierType;
  subscriptionId: string;
  resourceGroupName: string;
  frontendUrl?: string;
  advancedSettings: {
    enableLogging: boolean;
    autoDeleteDays: number | null;
    tags: TagPair[];
  };
  databaseConfig?: DatabaseConfig;
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

export interface UserAzureContext {
  subscriptions: AzureSubscription[];
  defaultSubscription?: AzureSubscription;
}

export interface ProvisionInstanceResponse {
  id: string;
  instanceName: string;
  status: "provisioning" | "ready" | "failed" | "deleting" | "deleted";
  url?: string;
  createdAt: string;
  environment: EnvironmentType;
  region: RegionType;
  serviceType: ServiceType;
  runtime?: RuntimeType;
  planTier?: PlanTierType;
  errorMessage?: string;
  subscriptionId?: string;
  resourceGroupName?: string;
  appServiceName?: string;
  appServicePlanName?: string;
  databaseEngine?: DatabaseEngineType;
  databaseServerName?: string;
  databaseName?: string;
}

export interface ListInstancesResponse {
  instances: ProvisionInstanceResponse[];
  total: number;
}

export interface ProvisioningProgress {
  instanceId: string;
  stage: string;
  message: string;
  timestamp: string;
  success: boolean;
}