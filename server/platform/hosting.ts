/**
 * DevX hosting target: drives LLM, secrets bootstrap, object storage, and which
 * work-item platforms are available in the UI.
 *
 * Today: `process.env.DEVX_HOSTING` (`azure` | `aws`). Default `azure`.
 * Future: resolve per-tenant (e.g. from DB) and thread through AsyncLocalStorage.
 */

export type HostingProvider = "azure" | "aws";
export type AuthMode = "msal" | "amplify" | "keycloak";
export type WorkItemPlatform = "ado" | "jira";

export function getHosting(): HostingProvider {
  const raw = (process.env.DEVX_HOSTING || "azure").toLowerCase().trim();
  if (raw === "aws") return "aws";
  return "azure";
}

export function isAwsHosting(): boolean {
  return getHosting() === "aws";
}

export function isAzureHosting(): boolean {
  return getHosting() === "azure";
}

/**
 * Auth mode is independent of hosting mode.
 * DEVX_AUTH_MODE=msal  → validate Azure AD / Entra ID tokens (MSAL)
 * DEVX_AUTH_MODE=amplify → validate Cognito tokens (Amplify)
 * DEVX_AUTH_MODE=keycloak → validate generic OIDC / Keycloak tokens
 * Default: msal when DEVX_HOSTING=azure, amplify when DEVX_HOSTING=aws (backward-compat).
 */
export function getAuthMode(): AuthMode {
  const oidcFlag = String(process.env.OIDC_ENABLED || process.env.KEYCLOAK_ENABLED || "")
    .toLowerCase()
    .trim();
  if (["true", "1", "yes", "on"].includes(oidcFlag)) return "keycloak";

  const raw = (process.env.DEVX_AUTH_MODE || "").toLowerCase().trim();
  if (raw === "msal") return "msal";
  if (raw === "amplify") return "amplify";
  if (raw === "keycloak" || raw === "oidc") return "keycloak";
  return isAwsHosting() ? "amplify" : "msal";
}

export function isAuthModeMsal(): boolean {
  return getAuthMode() === "msal";
}

export function isAuthModeKeycloak(): boolean {
  return getAuthMode() === "keycloak";
}

/** Work-item / ALM tools exposed in the product for this deployment. */
export function getAllowedWorkItemPlatforms(): WorkItemPlatform[] {
  if (isAwsHosting()) return ["jira"];
  return ["ado", "jira"];
}

export function isAdoWorkItemsAllowed(): boolean {
  return getAllowedWorkItemPlatforms().includes("ado");
}

/**
 * @deprecated Use tenant-scoped resolution when multi-hosting per tenant is implemented.
 */
export function getHostingForTenant(_tenantId: string | undefined): HostingProvider {
  return getHosting();
}

/** Read a feature flag from process.env (populated by Secrets Manager at startup). */
function getFeatureFlag(envKey: string, fallbackViteKey?: string): boolean {
  const raw = process.env[envKey] ?? process.env[fallbackViteKey ?? ""] ?? "";
  return raw.trim().toLowerCase() === "true";
}

/**
 * Public WebSocket URL exposed to the Chrome extension when NAT 2.0 auto-provisions
 * a session. Set this when the app is fronted by something that does NOT support
 * WebSocket upgrades (e.g. AWS API Gateway HTTP API), so the extension can WS
 * directly to the EC2 host instead of the public ingress.
 *
 * Format: `ws://host:port` or `wss://host:port` (no path — the extension appends
 * `/ws/recorder`). Returns `null` when unset, in which case the client falls back
 * to `window.location.origin` (correct for localhost and any deployment that
 * supports WebSocket upgrades on the same origin).
 */
export function getExtensionWsPublicUrl(): string | null {
  const raw = (process.env.EXTENSION_WS_PUBLIC_URL || "").trim();
  return raw || null;
}

/** S3 bucket for NAT 2.0 download artifacts (chrome extension, remote agent). */
export function getNatS3Bucket(): string {
  return (
    process.env.NAT_S3_BUCKET?.trim() ||
    process.env.S3_DESIGN_BUCKET?.trim() ||
    process.env.DESIGN_PROMPTS_S3_BUCKET?.trim() ||
    process.env.AWS_DESIGN_PROMPTS_BUCKET?.trim()
  );
}

/** S3 key prefix (folder) inside the NAT bucket. */
export function getNatS3Prefix(): string {
  const raw = process.env.NAT_S3_PREFIX?.trim();
  return raw || "NAT-Extensions";
}

export function getHostingConfigResponse(overrides?: { githubOwner?: string }) {
  return {
    hosting: getHosting(),
    allowedWorkItemPlatforms: getAllowedWorkItemPlatforms(),
    githubOwner: overrides?.githubOwner || process.env.GITHUB_OWNER || "",
    extensionWsPublicUrl: getExtensionWsPublicUrl(),
    features: {
      sdlc: getFeatureFlag("FEATURE_SDLC", "VITE_FEATURE_SDLC"),
      quick_workflow: getFeatureFlag("FEATURE_QUICK_WORKFLOW", "VITE_FEATURE_QUICK_WORKFLOW"),
      stack_modernization: getFeatureFlag("FEATURE_STACK_MODERNIZATION", "VITE_FEATURE_STACK_MODERNIZATION"),
      jira_onboarding_wizard: getFeatureFlag("FEATURE_JIRA_ONBOARDING_WIZARD", "VITE_FEATURE_JIRA_ONBOARDING_WIZARD"),
    },
  };
}
