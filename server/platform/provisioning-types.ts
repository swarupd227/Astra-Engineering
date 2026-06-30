/**
 * Future AWS-side provisioning (parallel to Azure ARM flows in provisioningRoutes).
 * Implement when product requirements are defined.
 */
export interface IProvisioningService {
  provisionTenantInfrastructure?(_input: {
    tenantId: string;
    region?: string;
  }): Promise<{ status: string }>;
}
