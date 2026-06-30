export type EnvironmentType = "Development" | "QA" | "Production";

export type RegionType = "canadacentral" | "eastus" | "westus";

export type RuntimeType = "Node 20 LTS";

export type PlanTierType = "Basic (B1)" | "Standard (S1)";

export interface TagPair {
  key: string;
  value: string;
}

export interface CreateInstancePayload {
  instanceName: string;
  environment: EnvironmentType;
  region: RegionType;
  runtime: RuntimeType;
  planTier: PlanTierType;
  advancedSettings: {
    enableLogging: boolean;
    autoDeleteDays: number | null;
    tags: TagPair[];
  };
}

export interface ProvisionInstanceResponse {
  id: string;
  instanceName: string;
  status: "provisioning" | "ready" | "failed";
  url?: string;
  createdAt: string;
  environment: EnvironmentType;
  region: RegionType;
  runtime: RuntimeType;
  planTier: PlanTierType;
}
