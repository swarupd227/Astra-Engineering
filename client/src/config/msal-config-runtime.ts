import { getApiUrl } from "@/lib/api-config";
import { buildMsalConfiguration } from "./msalConfig";

export type RuntimeMsalConfig = {
  clientId: string;
  tenantId: string;
};

function buildTimeMsalIds(): RuntimeMsalConfig | null {
  const clientId = import.meta.env.VITE_AZURE_AD_CLIENT_ID?.trim();
  const tenantId = import.meta.env.VITE_AZURE_AD_TENANT_ID?.trim();
  if (!clientId || !tenantId) return null;
  return { clientId, tenantId };
}

/** EKS: load Entra IDs from server (Secrets Manager). Build-time VITE_* used as fallback. */
export async function resolveMsalConfiguration() {
  const fromBuild = buildTimeMsalIds();

  try {
    const response = await fetch(getApiUrl("/api/auth/msal-config"), {
      credentials: "include",
    });
    if (response.ok) {
      const data = (await response.json()) as Partial<RuntimeMsalConfig>;
      const clientId = data.clientId?.trim();
      const tenantId = data.tenantId?.trim();
      if (clientId && tenantId) {
        console.log("[Auth] MSAL config from server (Secrets Manager)");
        return buildMsalConfiguration(clientId, tenantId);
      }
    }
  } catch (error) {
    console.warn("[Auth] Could not load /api/auth/msal-config:", error);
  }

  if (fromBuild) {
    console.log("[Auth] MSAL config from build-time VITE_AZURE_AD_*");
    return buildMsalConfiguration(fromBuild.clientId, fromBuild.tenantId);
  }

  throw new Error(
    "MSAL is not configured. Set AZURE_AD_CLIENT_ID and AZURE_AD_TENANT_ID in AWS Secrets Manager " +
      "(or VITE_AZURE_AD_* in the Docker build) and ensure DEVX_AUTH_MODE=msal.",
  );
}
