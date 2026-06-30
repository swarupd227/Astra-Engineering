import { db } from "../../db";
import { integrations } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { OperationsAdapter, MonitoringAdapter } from "../../types/adapters";
import { ServiceNowAdapter } from "./serviceNowAdapter";
import { DatadogAdapter } from "./datadogAdapter";
import { resolveProjectIntegrationCategory } from "../project-integration-resolver";

// ── Datadog siteRegion → base URL (mirrors tool-integration-routes.ts logic) ──
function resolveDatadogBaseUrl(config: Record<string, string>): string {
  const rawSite = (config.siteRegion || config.site || config.region || "").replace(/\/+$/, "").trim();
  const site = rawSite.toLowerCase();
  const aliases: Record<string, string> = {
    us1: "https://api.datadoghq.com",
    us: "https://api.datadoghq.com",
    default: "https://api.datadoghq.com",
    us3: "https://api.us3.datadoghq.com",
    us5: "https://api.us5.datadoghq.com",
    eu: "https://api.datadoghq.eu",
    ap1: "https://api.ap1.datadoghq.com",
    ap2: "https://api.ap2.datadoghq.com",
    "us1-fed": "https://api.ddog-gov.com",
    gov: "https://api.ddog-gov.com",
  };
  if (!site) return "https://api.datadoghq.com";
  if (aliases[site]) return aliases[site];
  if (/^https?:\/\//i.test(rawSite)) return rawSite;
  if (/^api\./i.test(rawSite)) return `https://${rawSite}`;
  return `https://api.${rawSite}`;
}

// ── ServiceNow Basic Auth: encode username:password ────────────────────────
function toBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`).toString("base64");
}

export class AdapterFactory {
  /**
   * Try to resolve Datadog credentials from project_integration_configs first.
   * Falls back to the legacy integrations table.
   */
  static async getMonitoringAdapter(tenantId: string, projectId?: string | null): Promise<MonitoringAdapter> {
    // 1. New system: project_integration_configs "monitoring" category
    if (projectId) {
      try {
        const resolved = await resolveProjectIntegrationCategory(projectId, "monitoring");
        if (resolved.status === "configured" && resolved.providerKey === "datadog") {
          const cfg = resolved.config;
          const apiKey = cfg.apiKey || cfg.api_key || "";
          const appKey = cfg.applicationKey || cfg.appKey || cfg.app_key || "";
          const baseUrl = resolveDatadogBaseUrl(cfg);
          if (apiKey && appKey) {
            console.log(`[AdapterFactory] Using project_integration_configs Datadog for project ${projectId}`);
            return new DatadogAdapter(apiKey, appKey, baseUrl);
          }
        }
      } catch (err: any) {
        console.warn("[AdapterFactory] project_integration_configs monitoring lookup failed, falling back:", err?.message);
      }
    }

    // 2. Legacy: integrations table (project-scoped then tenant-wide)
    const config = await this.getLegacyIntegration(tenantId, "datadog", projectId);
    if (!config) throw new Error(`No active monitoring integration found for tenant ${tenantId}. Configure Datadog in the project's Tool Configuration.`);
    if (!config.appKey) throw new Error("Datadog integration requires both an api_key and an app_key.");
    return new DatadogAdapter(config.apiKey, config.appKey, config.baseUrl);
  }

  /**
   * Try to resolve ServiceNow credentials from project_integration_configs first.
   * Falls back to the legacy integrations table.
   */
  static async getOperationsAdapter(tenantId: string, projectId?: string | null): Promise<OperationsAdapter> {
    // 1. New system: project_integration_configs "ticketing" category
    if (projectId) {
      try {
        const resolved = await resolveProjectIntegrationCategory(projectId, "ticketing");
        if (resolved.status === "configured" && resolved.providerKey === "servicenow") {
          const cfg = resolved.config;
          const instanceUrl = cfg.instanceUrl || cfg.baseUrl || "";
          const username = cfg.username || "";
          const apiToken = cfg.apiToken || cfg.password || "";
          if (instanceUrl && username && apiToken) {
            const basicAuth = toBasicAuth(username, apiToken);
            console.log(`[AdapterFactory] Using project_integration_configs ServiceNow for project ${projectId}`);
            return new ServiceNowAdapter(instanceUrl, basicAuth);
          }
        }
      } catch (err: any) {
        console.warn("[AdapterFactory] project_integration_configs ticketing lookup failed, falling back:", err?.message);
      }
    }

    // 2. Legacy: integrations table (project-scoped then tenant-wide)
    const config = await this.getLegacyIntegration(tenantId, "servicenow", projectId);
    if (!config) throw new Error(`No active operations integration found for tenant ${tenantId}. Configure ServiceNow in the project's Tool Configuration.`);
    if (!config.baseUrl) throw new Error("ServiceNow integration requires a base_url in the configuration.");
    return new ServiceNowAdapter(config.baseUrl, config.apiKey);
  }

  /** Legacy integrations table lookup — project-scoped first, then tenant-wide. */
  private static async getLegacyIntegration(
    tenantId: string,
    integrationType: "datadog" | "servicenow",
    projectId?: string | null,
  ) {
    if (projectId) {
      const rows = await db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.tenantId, tenantId),
            eq(integrations.integrationType, integrationType),
            eq(integrations.projectId, projectId),
            eq(integrations.status, "active"),
          ),
        );
      if (rows.length > 0) return rows[0];
    }

    const tenantRows = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.integrationType, integrationType),
          isNull(integrations.projectId),
          eq(integrations.status, "active"),
        ),
      );
    return tenantRows[0] ?? null;
  }
}
