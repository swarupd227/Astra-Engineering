/**
 * Static registry of platform activities for RBAC.
 * Source of truth for what activities exist; not stored in DB.
 */

/** Action columns for resource × action checkbox matrix (view, create, update, delete, sync, test, approval). */
export const ACTION_COLUMNS = [
  "view",
  "create",
  "update",
  "delete",
  "sync",
  "test",
  "approval",
] as const;
export type ActionKey = (typeof ACTION_COLUMNS)[number];

export type ActivityEntry = {
  key: string;
  description: string;
};

// SDLC resource order for Admin Activity UI (card sequence)
const SDLC_RESOURCE_ORDER = [
  "SDLC_BRD",
  "SDLC_BACKLOG",
  "SDLC_DESIGN",
  "SDLC_DEVELOPMENT",
  "SDLC_TEST",
  "SDLC_BUILD",
  "SDLC_DEPLOY",
  "SDLC_MAINTENANCE",
];

/** Parse activity key into resource name and action for matrix display. */
export function parseActivityKeyToResourceAction(
  activityKey: string
): { resource: string; action: ActionKey } | null {
  const segments = activityKey.split("_");
  if (segments.length < 2) return null;
  const last = segments[segments.length - 1];
  const last2 = segments.slice(-2).join("_");

  const actionMap: Record<string, ActionKey> = {
    CREATE: "create",
    UPDATE: "update",
    DELETE: "delete",
    SYNC: "sync",
    LIST: "view",
    GET: "view",
    DOWNLOAD: "view",
    VIEW: "view",
    GENERATE: "create",
    UPLOAD: "create",
    SEED: "create",
    SAVE: "create",
    INITIALIZE: "create",
    ATTACH: "create",
    ATTACH_BRD: "create",
    ATTACH_DEV_BRD: "create",
    PUSH_DEVOPS: "sync",
    PUSH_DEVOPS_NO_SKIP: "sync",
    PUSH_DEVOPS_FROM_SDLC: "sync",
    PUSH_TO_ADO: "sync",
    PUSH_TO_EPIC: "sync",
    PUSH_DRAFTS_BULK: "sync",
    EXPORT_DOCX: "view",
    EXPORT_PDF: "view",
    TEST_ADO: "test",
    TEST_CONNECTION: "test",
    APPROVAL: "approval",
    APPROVE: "approval",
  };
  if (actionMap[last2]) {
    return {
      resource: segments.slice(0, -2).join("_"),
      action: actionMap[last2],
    };
  }
  if (actionMap[last]) {
    return {
      resource: segments.slice(0, -1).join("_"),
      action: actionMap[last],
    };
  }
  if (last.startsWith("TEST")) {
    return {
      resource: segments.slice(0, -1).join("_"),
      action: "test",
    };
  }
  if (last.startsWith("EXPORT")) {
    return {
      resource: segments.slice(0, -1).join("_"),
      action: "view",
    };
  }
  return null;
}

export type ResourceActionRow = {
  resource: string;
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  sync: boolean;
  test: boolean;
  approval: boolean;
};

/** Build resource × action matrix per feature for checkbox table. */
export function getResourceActionMatrixByFeature(
  featureIds: string[]
): Record<string, ResourceActionRow[]> {
  const byFeature: Record<string, Record<string, Partial<Record<ActionKey, boolean>>>> = {};
  for (const id of featureIds) byFeature[id] = {};
  byFeature["other"] = {};

  for (const activity of ACTIVITY_REGISTRY) {
    const featureId = getFeatureIdForActivity(activity.key);
    let parsed = parseActivityKeyToResourceAction(activity.key);
    if (!parsed) {
      const segments = activity.key.split("_");
      parsed =
        segments.length >= 2
          ? { resource: segments.slice(0, -1).join("_"), action: "view" as ActionKey }
          : { resource: activity.key, action: "view" as ActionKey };
    }
    const { resource, action } = parsed;
    if (!byFeature[featureId]) byFeature[featureId] = {};
    if (!byFeature[featureId][resource]) {
      byFeature[featureId][resource] = {};
    }
    byFeature[featureId][resource][action] = true;
  }

  const result: Record<string, ResourceActionRow[]> = {};
  for (const [featureId, resourceMap] of Object.entries(byFeature)) {
    result[featureId] = Object.entries(resourceMap)
      .map(([resource, actions]) => ({
        resource,
        view: !!actions.view,
        create: !!actions.create,
        update: !!actions.update,
        delete: !!actions.delete,
        sync: !!actions.sync,
        test: !!actions.test,
        approval: !!(actions as any).approval,
      }))
      .sort((a, b) => {
        // For SDLC feature, use card sequence order
        if (featureId === "sdlc") {
          const ia = SDLC_RESOURCE_ORDER.indexOf(a.resource);
          const ib = SDLC_RESOURCE_ORDER.indexOf(b.resource);
          if (ia === -1 && ib === -1) return a.resource.localeCompare(b.resource);
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        }
        // Default: alphabetical
        return a.resource.localeCompare(b.resource);
      });
  }
  return result;
}

/** Maps activity key prefix to feature ID for segregation by feature. */
const ACTIVITY_TO_FEATURE: Record<string, string> = {
  BRD_: "brd",
  DEV_BRD_: "dev_brd",
  WORKFLOW_: "workflow",
  WIKI_: "wiki",
  TESTING_: "testing",
  AI_: "ai",
  ADMIN_: "admin",
  SDLC_: "sdlc",
  CREATE_PROJECT: "ado",
  CREATE_AZURE_ADO_PROJECT: "ado",
  ADO_: "ado",
  HUB_: "hub",
  GOLDEN_REPOS_: "golden_repos",
  ARTIFACT_ORGANIZATION_: "artifact_org",
  DESIGN_MAPPING_: "design_mapping",
  PERSONAS_: "personas",
  SUPER_AGENT_: "super_agent",
  RAG_: "super_agent",
  AUTH_: "auth",
};

export function getFeatureIdForActivity(activityKey: string): string {
  for (const [prefix, featureId] of Object.entries(ACTIVITY_TO_FEATURE)) {
    if (prefix.endsWith("_") && activityKey.startsWith(prefix)) return featureId;
    if (prefix === activityKey) return featureId;
  }
  return "other";
}

/** Get activity key for a given resource and action (used for saving role-activity-permissions). */
export function getActivityKeyForResourceAction(
  resource: string,
  action: ActionKey
): string | null {
  for (const activity of ACTIVITY_REGISTRY) {
    const parsed = parseActivityKeyToResourceAction(activity.key);
    if (parsed && parsed.resource === resource && parsed.action === action) {
      return activity.key;
    }
  }
  return null;
}

/** Activities grouped by feature ID for segregated display. */
export function getActivitiesByFeature(
  featureIds: string[]
): Record<string, ActivityEntry[]> {
  const byFeature: Record<string, ActivityEntry[]> = {};
  for (const id of featureIds) byFeature[id] = [];
  byFeature["other"] = [];

  for (const activity of ACTIVITY_REGISTRY) {
    const featureId = getFeatureIdForActivity(activity.key);
    if (!byFeature[featureId]) byFeature[featureId] = [];
    byFeature[featureId].push(activity);
  }

  return byFeature;
}

export const ACTIVITY_REGISTRY: ActivityEntry[] = [
  // =====================================================
  // Artifact Organizations (show first)
  // =====================================================
  { key: "ARTIFACT_ORGANIZATION_LIST", description: "View/list artifact organizations" },
  { key: "ARTIFACT_ORGANIZATION_CREATE", description: "Create artifact organization" },
  { key: "ARTIFACT_ORGANIZATION_UPDATE", description: "Update artifact organization" },
  { key: "ARTIFACT_ORGANIZATION_DELETE", description: "Delete artifact organization" },
  { key: "ARTIFACT_ORGANIZATION_TEST_ADO", description: "Test ADO for organization" },

  // =====================================================
  // Projects (ADO only)
  // =====================================================
  // ADO projects
  { key: "ADO_PROJECT_LIST", description: "View/list ADO projects" },
  { key: "ADO_PROJECT_CREATE", description: "Create ADO project" },
  { key: "CREATE_PROJECT", description: "Create project" },
  { key: "CREATE_AZURE_ADO_PROJECT", description: "Create Azure ADO project" },
  { key: "ADO_PROJECT_UPDATE", description: "Update ADO project" },
  { key: "ADO_PROJECT_DELETE", description: "Delete ADO project" },
  { key: "GOLDEN_REPOS_CREATE", description: "Create golden repo source configuration" },
  { key: "GOLDEN_REPOS_UPDATE", description: "Update golden repo source configuration" },
  { key: "GOLDEN_REPOS_DELETE", description: "Delete golden repo source configuration" },

  // =====================================================
  // SDLC cards – BRD Generator
  // =====================================================
  { key: "SDLC_BRD_VIEW", description: "View BRD generator" },
  { key: "SDLC_BRD_CREATE", description: "Create/generate BRDs" },
  { key: "SDLC_BRD_UPDATE", description: "Update BRDs" },
  { key: "SDLC_BRD_DELETE", description: "Delete BRDs" },
  { key: "SDLC_BRD_APPROVAL", description: "Approve BRDs" },

  // =====================================================
  // SDLC cards – Backlogs
  // =====================================================
  { key: "SDLC_BACKLOG_VIEW", description: "View SDLC backlogs" },
  { key: "SDLC_BACKLOG_CREATE", description: "Generate backlog artifacts" },
  { key: "SDLC_BACKLOG_UPDATE", description: "Update backlog items" },
  { key: "SDLC_BACKLOG_DELETE", description: "Delete backlog items" },

  // =====================================================
  // SDLC cards – Design
  // =====================================================
  { key: "SDLC_DESIGN_VIEW", description: "View SDLC design" },
  { key: "SDLC_DESIGN_CREATE", description: "Create/generate SDLC design assets/guidelines" },
  { key: "SDLC_DESIGN_UPDATE", description: "Update SDLC design assets/guidelines" },
  { key: "SDLC_DESIGN_DELETE", description: "Delete SDLC design assets/guidelines" },

  // =====================================================
  // SDLC cards – Development
  // =====================================================
  { key: "SDLC_DEVELOPMENT_VIEW", description: "View SDLC development" },
  { key: "SDLC_DEVELOPMENT_CREATE", description: "Create/generate SDLC development artifacts/code" },
  { key: "SDLC_DEVELOPMENT_UPDATE", description: "Update SDLC development artifacts/code" },
  { key: "SDLC_DEVELOPMENT_DELETE", description: "Delete SDLC development artifacts/code" },

  // =====================================================
  // SDLC cards – Testing
  // =====================================================
  { key: "SDLC_TEST_VIEW", description: "View SDLC testing" },
  { key: "SDLC_TEST_CREATE", description: "Create/generate SDLC tests and plans" },
  { key: "SDLC_TEST_UPDATE", description: "Update SDLC tests and plans" },
  { key: "SDLC_TEST_DELETE", description: "Delete SDLC tests and plans" },
  { key: "SDLC_TEST_SYNC", description: "Sync SDLC tests with Azure DevOps" },

  // =====================================================
  // SDLC cards – Build
  // =====================================================
  { key: "SDLC_BUILD_VIEW", description: "View SDLC build status" },
  { key: "SDLC_BUILD_UPDATE", description: "Update/configure SDLC builds" },

  // =====================================================
  // SDLC cards – Deployment
  // =====================================================
  { key: "SDLC_DEPLOY_VIEW", description: "View SDLC deployments" },
  { key: "SDLC_DEPLOY_UPDATE", description: "Update/configure SDLC deployments" },

  // =====================================================
  // SDLC cards – Maintenance
  // =====================================================
  { key: "SDLC_MAINTENANCE_VIEW", description: "View SDLC maintenance" },
  { key: "SDLC_MAINTENANCE_UPDATE", description: "Update SDLC maintenance tasks" },

  // =====================================================
  // Ask Astra / Quick Workflow / Stack Modernization
  // =====================================================
  { key: "ASK_DEVX_USE", description: "Use Ask Astra assistant" },
  { key: "ASK_DEVX_MANAGE", description: "Manage Ask Astra settings and sources" },
  { key: "QUICK_WORKFLOW_USE", description: "Use Quick Workflow" },
  { key: "QUICK_WORKFLOW_MANAGE", description: "Manage Quick Workflow templates and presets" },
  { key: "STACK_MODERNIZATION_VIEW", description: "View stack modernization insights" },
  { key: "STACK_MODERNIZATION_RUN", description: "Run stack modernization analysis" },
  { key: "STACK_MODERNIZATION_MANAGE", description: "Manage stack modernization configuration" },
];
