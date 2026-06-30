import { getAuthMode } from "../platform/hosting";

/**
 * Public MSAL settings for the SPA (client ID + tenant).
 * On EKS, values come from AWS Secrets Manager via loadSecrets() before the server listens.
 */
export type MsalPublicConfig = {
  authMode: "msal" | "amplify" | "keycloak";
  clientId: string;
  tenantId: string;
};

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function getMsalPublicConfig(): MsalPublicConfig | null {
  const authMode = getAuthMode();

  const clientId = firstNonEmpty(
    process.env.AZURE_AD_CLIENT_ID,
    process.env.VITE_AZURE_AD_CLIENT_ID,
  );
  const tenantId = firstNonEmpty(
    process.env.AZURE_AD_TENANT_ID,
    process.env.VITE_AZURE_AD_TENANT_ID,
  );

  if (!clientId || !tenantId) {
    return null;
  }

  return { authMode, clientId, tenantId };
}
