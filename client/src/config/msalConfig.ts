import { Configuration, RedirectRequest, LogLevel } from "@azure/msal-browser";

function getConfiguredRedirectUri() {
  const viteEnv = import.meta.env as {
    VITE_MSAL_REDIRECT_URI?: string;
  };
  return viteEnv.VITE_MSAL_REDIRECT_URI?.trim();
}

/** SPA redirect URI registered in Entra (defaults to site root). */
export function buildMsalRedirectUri(origin: string = window.location.origin) {
  const configuredRedirectUri = getConfiguredRedirectUri();
  if (configuredRedirectUri) {
    return new URL(configuredRedirectUri, origin).toString();
  }
  return new URL("/", origin).toString();
}

export function buildMsalLogoutPopupUri(origin: string = window.location.origin) {
  return new URL("/logout.html", origin).toString();
}

export function buildMsalMainWindowUri(origin: string = window.location.origin) {
  return new URL("/", origin).toString();
}

export function buildMsalConfiguration(
  clientId: string,
  tenantId: string,
): Configuration {
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: buildMsalRedirectUri(),
      navigateToLoginRequestUrl: false,
      knownAuthorities: ["login.microsoftonline.com"],
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return;
          console.log(`[MSAL ${level}] ${message}`);
        },
        logLevel: LogLevel.Info,
      },
    },
  };
}

const buildTimeClientId = import.meta.env.VITE_AZURE_AD_CLIENT_ID?.trim() || "";
const buildTimeTenantId = import.meta.env.VITE_AZURE_AD_TENANT_ID?.trim() || "";

/** Legacy static export — prefer resolveMsalConfiguration() on EKS. */
export const msalConfig: Configuration = buildMsalConfiguration(
  buildTimeClientId,
  buildTimeTenantId || "common",
);

export const loginRequest: RedirectRequest = {
  scopes: ["User.Read"],
};

export const msalClientId = buildTimeClientId;

export const azureManagementRequest = {
  scopes: ["https://management.azure.com/user_impersonation"],
};

export const graphAppWriteRequest = {
  scopes: ["https://graph.microsoft.com/Application.ReadWrite.OwnedBy"],
};

export const graphConfig = {
  graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
};
