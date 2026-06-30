import { createHash } from "crypto";

export function envEnabled(value: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function getFirstEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

export function getOidcProviderId(): string {
  const explicit = getFirstEnv("OIDC_PROVIDER_ID", "KEYCLOAK_PROVIDER_ID");
  if (explicit) return explicit;
  const name = getFirstEnv("OIDC_PROVIDER_NAME", "KEYCLOAK_PROVIDER_NAME");
  return name ? name.toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "keycloak";
}

export function getOidcIssuer(): string {
  return getFirstEnv("OIDC_ISSUER", "KEYCLOAK_ISSUER").replace(/\/+$/, "");
}

export function getOidcClientId(): string {
  return getFirstEnv("OIDC_CLIENT_ID", "KEYCLOAK_CLIENT_ID");
}

export function isOidcEnabled(): boolean {
  return (
    (envEnabled(process.env.OIDC_ENABLED) ||
      envEnabled(process.env.KEYCLOAK_ENABLED) ||
      ["keycloak", "oidc"].includes(String(process.env.DEVX_AUTH_MODE || "").toLowerCase().trim())) &&
    Boolean(getOidcIssuer()) &&
    Boolean(getOidcClientId())
  );
}

export function getOidcClockToleranceSeconds(): number {
  const value = getFirstEnv(
    "OIDC_CLOCK_TOLERANCE_SECONDS",
    "KEYCLOAK_CLOCK_TOLERANCE_SECONDS",
    "VITE_OIDC_CLOCK_TOLERANCE_SECONDS",
    "VITE_KEYCLOAK_CLOCK_TOLERANCE_SECONDS",
  );
  if (!value) return 300;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 300;
  return Math.min(Math.floor(parsed), 31_536_000);
}

export function getOidcTenantClaimNames(): string[] {
  const configured = getFirstEnv("OIDC_TENANT_CLAIM", "KEYCLOAK_TENANT_CLAIM");
  const names = configured
    ? configured.split(",").map((name) => name.trim()).filter(Boolean)
    : [];
  return [
    ...names,
    "tid",
    "tenant_id",
    "tenantId",
    "tenant",
    "org_id",
    "organization_id",
    "realm",
    "realm_id",
  ];
}

export function stableTenantIdFromIssuer(issuer: string): string {
  return `oidc-${createHash("sha256").update(issuer).digest("hex").slice(0, 31)}`;
}

export function normalizeTenantIdForStorage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 36) return trimmed;
  return `oidc-${createHash("sha256").update(trimmed).digest("hex").slice(0, 31)}`;
}

export function extractOidcTenantId(payload: Record<string, unknown>): string {
  for (const claimName of getOidcTenantClaimNames()) {
    const value = claimName.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
    if (typeof value === "string" && value.trim()) {
      return normalizeTenantIdForStorage(value);
    }
  }

  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  return issuer ? stableTenantIdFromIssuer(issuer) : "";
}
