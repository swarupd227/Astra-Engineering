import type { Express, Request, Response } from "express";
import { db } from "./db";
import { users, integrations } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { AdapterFactory } from "./services/adapters/adapterFactory";
import { requireAuth, autoBootstrapUser } from "./auth/middleware";
import { Octokit } from "octokit";

type SupportedIntegrationType = "datadog" | "servicenow" | "github";
type CachedIntegrationPayload<T> = {
  expiresAt: number;
  value: T;
};

const SUPPORTED_INTEGRATION_TYPES: SupportedIntegrationType[] = ["datadog", "servicenow", "github"];
const MONITORING_CACHE_TTL_MS = 60 * 1000;
const OPERATIONS_CACHE_TTL_MS = 90 * 1000;
const monitoringCache = new Map<string, CachedIntegrationPayload<any>>();
const operationsCache = new Map<string, CachedIntegrationPayload<any>>();
const KEEP_EXISTING_TOKEN = "__KEEP_EXISTING__";

function getCachedPayload<T>(cache: Map<string, CachedIntegrationPayload<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedPayload<T>(cache: Map<string, CachedIntegrationPayload<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function normalizeIntegrationType(value: unknown): SupportedIntegrationType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_INTEGRATION_TYPES.includes(normalized as SupportedIntegrationType)
    ? (normalized as SupportedIntegrationType)
    : null;
}

/** Reads the project ID from the x-project-id request header */
function getSelectedProjectIdFromRequest(req: Request) {
  const rawValue = req.headers["x-project-id"];
  if (typeof rawValue !== "string") {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

async function getTenantIdFromRequest(req: Request) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return null;
  }

  const userRecord = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return userRecord[0]?.tenantId ?? null;
}

export function registerIntegrationsRoutes(app: Express) {
  // GET /api/integrations — list integrations for tenant, optionally filtered by project
  app.get("/api/integrations", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const projectId = getSelectedProjectIdFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized: Missing tenant context" });
      }

      const configuredIntegrations = await db
        .select({
          id: integrations.id,
          integrationType: integrations.integrationType,
          projectId: integrations.projectId,
          organizationId: integrations.organizationId,
          baseUrl: integrations.baseUrl,
          status: integrations.status,
          createdAt: integrations.createdAt,
          updatedAt: integrations.updatedAt,
          hasApiKey: integrations.apiKey,
          hasAppKey: integrations.appKey,
        })
        .from(integrations)
        .where(
          projectId
            ? and(eq(integrations.tenantId, tenantId), eq(integrations.projectId, projectId))
            : eq(integrations.tenantId, tenantId)
        );

      res.json({
        integrations: configuredIntegrations.map((integration) => ({
          id: integration.id,
          integrationType: integration.integrationType,
          projectId: integration.projectId,
          organizationId: integration.organizationId,
          baseUrl: integration.baseUrl,
          status: integration.status,
          createdAt: integration.createdAt,
          updatedAt: integration.updatedAt,
          hasApiKey: Boolean(integration.hasApiKey),
          hasAppKey: Boolean(integration.hasAppKey),
        })),
      });
    } catch (error: any) {
      console.error("[Integrations API] Error listing integrations:", error);
      res.status(500).json({ error: "Failed to fetch integrations" });
    }
  });

  app.get("/api/integrations/github/config", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized: Missing tenant context" });
      }

      const rows = await db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.tenantId, tenantId),
            eq(integrations.integrationType, "github"),
            isNull(integrations.organizationId),
            isNull(integrations.projectId),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        return res.status(404).json({ configured: false });
      }

      const maskedApiKey = row.apiKey
        ? `${row.apiKey.slice(0, 4)}${"*".repeat(Math.max(0, row.apiKey.length - 8))}${row.apiKey.slice(-4)}`
        : undefined;

      return res.json({
        configured: true,
        maskedApiKey,
        appKey: row.appKey || "",
        baseUrl: row.baseUrl || "",
        updatedAt: row.updatedAt,
      });
    } catch (error: any) {
      console.error("[GitHub Config API] Error:", error);
      return res.status(500).json({ error: "Failed to fetch GitHub configuration" });
    }
  });

  app.post("/api/integrations/test-github", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized: Missing tenant context" });
      }

      const owner = typeof req.body?.owner === "string" ? req.body.owner.trim() : "";
      const providedToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";

      if (!owner) {
        return res.status(400).json({ success: false, error: "Owner is required." });
      }

      let token = providedToken;
      if (!token) {
        const existing = await db
          .select({ apiKey: integrations.apiKey })
          .from(integrations)
          .where(
            and(
              eq(integrations.tenantId, tenantId),
              eq(integrations.integrationType, "github"),
              isNull(integrations.organizationId)
            ),
          )
          .limit(1);

        token = existing[0]?.apiKey || "";
      }

      if (!token) {
        return res.status(400).json({ success: false, error: "GitHub token is required." });
      }

      const octokit = new Octokit({ auth: token });
      let repoCount = 0;

      try {
        const { data } = await octokit.rest.repos.listForOrg({ org: owner, per_page: 100 });
        repoCount = data.length;
      } catch (orgError: any) {
        if (orgError?.status !== 404) {
          throw orgError;
        }

        const { data } = await octokit.rest.repos.listForUser({ username: owner, per_page: 100 });
        repoCount = data.length;
      }

      return res.json({
        success: true,
        repoCount,
      });
    } catch (error: any) {
      console.error("[GitHub Test API] Error:", error);
      return res.status(400).json({
        success: false,
        error: error?.message || "Could not connect to GitHub.",
      });
    }
  });

  // GET /api/monitoring/system-health — Datadog metrics for a specific project
  app.get("/api/monitoring/system-health", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const projectId = getSelectedProjectIdFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized: Missing tenant context" });
      }

      if (!projectId) {
        return res.status(400).json({ error: "Select a specific project to view Datadog metrics." });
      }

      const cacheKey = `${tenantId}:${projectId}`;
      const cachedMetrics = getCachedPayload(monitoringCache, cacheKey);
      if (cachedMetrics) {
        return res.json(cachedMetrics);
      }

      const adapter = await AdapterFactory.getMonitoringAdapter(tenantId, projectId);
      const metrics = await adapter.getMonitoringMetrics();

      setCachedPayload(monitoringCache, cacheKey, metrics, MONITORING_CACHE_TTL_MS);
      console.log(`[Monitoring API] /api/monitoring/system-health completed in ${Date.now() - startedAt}ms`);
      res.json(metrics);
    } catch (error: any) {
      console.error("[Monitoring API] Error:", error);
      if (typeof error?.message === "string" && error.message.includes("No active monitoring integration found")) {
        return res.status(404).json({ error: "Monitoring integration not configured for the selected project." });
      }
      res.status(500).json({ error: error.message || "Failed to fetch monitoring metrics" });
    }
  });

  // GET /api/operations/ticket-metrics — ServiceNow metrics for a specific project
  app.get("/api/operations/ticket-metrics", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const projectId = getSelectedProjectIdFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized: Missing tenant context" });
      }

      if (!projectId) {
        return res.status(400).json({ error: "Select a specific project to view ServiceNow metrics." });
      }

      const cacheKey = `${tenantId}:${projectId}`;
      const cachedMetrics = getCachedPayload(operationsCache, cacheKey);
      if (cachedMetrics) {
        return res.json(cachedMetrics);
      }

      const adapter = await AdapterFactory.getOperationsAdapter(tenantId, projectId);
      const metrics = await adapter.getOperationsMetrics();

      setCachedPayload(operationsCache, cacheKey, metrics, OPERATIONS_CACHE_TTL_MS);
      console.log(`[Operations API] /api/operations/ticket-metrics completed in ${Date.now() - startedAt}ms`);
      res.json(metrics);
    } catch (error: any) {
      console.error("[Operations API] Error:", error);
      if (typeof error?.message === "string" && error.message.includes("No active operations integration found")) {
        return res.status(404).json({ error: "Operations integration not configured for the selected project." });
      }
      res.status(500).json({ error: error.message || "Failed to fetch operations metrics" });
    }
  });

  // POST /api/integrations/configure — save Datadog/ServiceNow config scoped to a project
  app.post("/api/integrations/configure", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const projectId = getSelectedProjectIdFromRequest(req);
      if (!tenantId) return res.status(401).json({ message: "Unauthorized: Missing tenant context" });

      const integrationType = normalizeIntegrationType(req.body?.integrationType);

      if (!projectId && integrationType !== "github") {
        return res.status(400).json({ error: "Select a specific project before configuring integrations." });
      }
      const organizationId = typeof req.body?.organizationId === "string" ? req.body.organizationId.trim() : null;
      const rawApiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey : "";
      const apiKey = rawApiKey === KEEP_EXISTING_TOKEN ? KEEP_EXISTING_TOKEN : rawApiKey.trim();
      const appKey = typeof req.body?.appKey === "string" ? req.body.appKey.trim() : "";
      const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";

      if (!integrationType) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      if (integrationType !== "github" && !apiKey) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      if (integrationType !== "github" && !projectId) {
        return res.status(400).json({ error: "Select a specific project before configuring integrations." });
      }

      // Check if integration row already exists for this tenant + project
      const existing = await db.select().from(integrations)
        .where(and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.integrationType, integrationType),
          integrationType === "github"
            ? isNull(integrations.organizationId)
            : eq(integrations.projectId, projectId)
        ));

      const existingRow = existing[0];
      const resolvedApiKey = apiKey === KEEP_EXISTING_TOKEN ? existingRow?.apiKey || "" : apiKey;

      if ((integrationType === "github" && (!resolvedApiKey || !appKey)) || (integrationType !== "github" && !resolvedApiKey)) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      if (existingRow) {
        // Update existing keys
        await db.update(integrations)
          .set({
            apiKey: resolvedApiKey,
            appKey: appKey || null,
            baseUrl: baseUrl || null,
            status: 'active',
            updatedAt: new Date(),
            organizationId: integrationType === "github" ? null : organizationId,
            projectId: integrationType !== "github" ? projectId : null,
          })
          .where(and(
            eq(integrations.tenantId, tenantId),
            eq(integrations.integrationType, integrationType),
            integrationType === "github"
              ? isNull(integrations.organizationId)
              : eq(integrations.projectId, projectId)
          ));
      } else {
        // Create new keys
        await db.insert(integrations).values({
          id: randomUUID(),
          tenantId,
          organizationId: integrationType === "github" ? null : organizationId,
          projectId: integrationType !== "github" ? projectId : null,
          integrationType,
          apiKey: resolvedApiKey,
          appKey: appKey || null,
          baseUrl: baseUrl || null,
          status: 'active'
        });
      }

      // Invalidate caches for this project
      const cacheKey = `${tenantId}:${projectId}`;
      monitoringCache.delete(cacheKey);
      operationsCache.delete(cacheKey);

      res.json({
        message:
          integrationType === "github"
            ? "GitHub connection saved for your organization."
            : `${integrationType} integration successfully configured for project.`,
      });
    } catch (error: any) {
      console.error("[Integrations Config API] Error:", error);
      res.status(500).json({ error: "Failed to save integration configuration" });
    }
  });

  // DELETE /api/integrations/:integrationType — remove project-scoped integration
  app.delete("/api/integrations/:integrationType", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const projectId = getSelectedProjectIdFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ message: "Unauthorized: Missing tenant context" });
      }

      const integrationType = normalizeIntegrationType(req.params.integrationType);
      if (!integrationType) {
        return res.status(400).json({ error: "Unsupported integration type." });
      }
      if (integrationType !== "github" && !projectId) {
        return res.status(400).json({ error: "Select a specific project before deleting integrations." });
      }

      const existing = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.integrationType, integrationType),
          integrationType === "github"
            ? isNull(integrations.organizationId)
            : eq(integrations.projectId, projectId)
        ))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Integration configuration not found." });
      }

      await db
        .delete(integrations)
        .where(and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.integrationType, integrationType),
          integrationType === "github"
            ? isNull(integrations.organizationId)
            : eq(integrations.projectId, projectId)
        ));

      // Invalidate caches for this project
      const cacheKey = `${tenantId}:${projectId}`;
      monitoringCache.delete(cacheKey);
      operationsCache.delete(cacheKey);

      res.json({ message: `${integrationType} integration deleted successfully.` });
    } catch (error: any) {
      console.error("[Integrations Delete API] Error:", error);
      res.status(500).json({ error: "Failed to delete integration configuration" });
    }
  });
}
