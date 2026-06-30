import { IntegrationService } from './integration-interface';
import { IntegrationConfig, IntegrationType } from './integration-types';
import { db } from '../../db';
import { integrationSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class IntegrationFactory {
  static async createService(config: IntegrationConfig): Promise<IntegrationService> {
    if (config.type === 'ado') {
      const { AdoService } = await import('../ado/ado-service');
      return new AdoService({
        organization: config.organization || '',
        project: config.project || '',
        pat: config.pat || '',
      });
    } else if (config.type === 'jira') {
      const { JiraService } = await import('../jira/jira-service');
      return new JiraService({
        instanceUrl: config.instanceUrl || '',
        projectKey: config.projectKey || '',
        email: config.email || '',
        apiToken: config.apiToken || '',
      });
    }
    throw new Error(`Unsupported integration type: ${config.type}`);
  }

  static async getIntegrationType(projectId: string): Promise<IntegrationType> {
    try {
      const settings = await db
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.projectId, projectId))
        .limit(1);

      if (settings.length > 0) {
        return settings[0].integrationType as IntegrationType;
      }
    } catch (error) {
      // fall through
    }
    const { isAwsHosting } = await import("../../platform/hosting");
    const fallback: IntegrationType = isAwsHosting() ? 'jira' : 'ado';
    console.log(`[IntegrationFactory] No integration settings found, defaulting to ${fallback}`);
    return fallback;
  }

  static async setIntegrationType(projectId: string, type: IntegrationType): Promise<void> {
    const existing = await db
      .select()
      .from(integrationSettings)
      .where(eq(integrationSettings.projectId, projectId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(integrationSettings)
        .set({ integrationType: type, updatedAt: new Date() })
        .where(eq(integrationSettings.projectId, projectId));
    } else {
      await db.insert(integrationSettings).values({
        projectId,
        integrationType: type,
      });
    }
  }
}

export { IntegrationService, IntegrationConfig, IntegrationType };
