import { createRoot } from "react-dom/client";
import { PublicClientApplication, InteractionStatus } from "@azure/msal-browser";
import { MsalProvider, MsalContext } from "@azure/msal-react";
import { Amplify } from "aws-amplify";
import { Hub } from "aws-amplify/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import { resolveMsalConfiguration } from "@/config/msal-config-runtime";
import { amplifyConfig } from "@/config/amplify-config";
import App from "@/App";
import "@/index.css";
import { initApiInterceptor, resetSessionExpired } from "@/utils/api-interceptor";
import { getApiUrl } from "@/lib/api-config";
import { initApiInterceptorAmplify } from "@/utils/api-interceptor-amplify";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { AmplifyAuthProvider } from "@/contexts/amplify-auth-context";
import { clearStaleCognitoSession } from "@/lib/cognito-session";
import {
  clearKeycloakSession,
  getKeycloakBearerToken,
  getOidcProviderId,
  getOidcProviderName,
  handleKeycloakRedirect,
  isKeycloakAuthenticated,
  refreshKeycloakToken,
  storeKeycloakError,
} from "@/utils/keycloak-auth";
import type { KeycloakRedirectResult } from "@/utils/keycloak-auth";

const amplifyMode = isAmplifyAuthMode();
const keycloakMode = isKeycloakAuthMode();

const noopMsalInstance = {
  getAllAccounts: () => [],
  getActiveAccount: () => null,
  setActiveAccount: () => {},
  acquireTokenSilent: () => Promise.reject(new Error("MSAL unavailable in Amplify mode")),
  acquireTokenPopup: () => Promise.reject(new Error("MSAL unavailable in Amplify mode")),
  acquireTokenRedirect: () => Promise.reject(new Error("MSAL unavailable in Amplify mode")),
  loginPopup: () => Promise.reject(new Error("MSAL unavailable in Amplify mode")),
  loginRedirect: () => Promise.reject(new Error("MSAL unavailable in Amplify mode")),
  logoutPopup: () => Promise.resolve(),
  logoutRedirect: () => Promise.resolve(),
  handleRedirectPromise: () => Promise.resolve(null),
  addEventCallback: () => null,
  removeEventCallback: () => {},
  enableAccountStorageEvents: () => {},
  disableAccountStorageEvents: () => {},
  initialize: () => Promise.resolve(),
} as any;

async function waitForOAuthRedirectCompletion(): Promise<void> {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") || !params.has("state")) return;

  console.log("[Auth] OAuth callback detected — waiting for Cognito token exchange...");
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      console.warn("[Auth] OAuth callback wait timed out after 20s");
      resolve();
    }, 20_000);
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn") {
        window.clearTimeout(timeout);
        unsubscribe();
        console.log("[Auth] Cognito sign-in completed after redirect");
        resolve();
      }
      if (
        payload.event === "signInWithRedirect_failure" ||
        payload.event === "tokenRefresh_failure"
      ) {
        window.clearTimeout(timeout);
        unsubscribe();
        console.error("[Auth] Cognito session error:", payload.event, payload.data);
        void clearStaleCognitoSession();
        resolve();
      }
    });
  });
  try {
    await fetchAuthSession({ forceRefresh: true } as Parameters<typeof fetchAuthSession>[0]);
  } catch (err) {
    console.error("[Auth] fetchAuthSession after redirect failed:", err);
  }
}

async function bootstrapAmplifyApp() {
  Amplify.configure(amplifyConfig);
  await waitForOAuthRedirectCompletion();
  initApiInterceptorAmplify();
  const poolId = amplifyConfig.Auth?.Cognito?.userPoolId ?? "(missing)";
  const clientId = amplifyConfig.Auth?.Cognito?.userPoolClientId ?? "(missing)";
  console.log("[Auth] Cognito/Amplify mode — domain:", amplifyConfig.Auth?.Cognito?.loginWith?.oauth?.domain);
  console.log("[Auth] Cognito pool:", poolId, "client configured:", clientId !== "(missing)" && clientId.length > 0);
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <MsalContext.Provider
      value={{
        instance: noopMsalInstance,
        inProgress: InteractionStatus.None,
        accounts: [],
        logger: console as any,
      }}
    >
      <AmplifyAuthProvider>
        <App />
      </AmplifyAuthProvider>
    </MsalContext.Provider>,
  );
}

async function bootstrapAuthenticatedUser(bearerTokenOverride?: string): Promise<boolean> {
  const bearerToken = bearerTokenOverride || getKeycloakBearerToken() || undefined;
  if (!bearerToken) return false;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${bearerToken}`,
  };
  if (isKeycloakAuthMode()) {
    headers["x-auth-provider"] = getOidcProviderId();
  }
  try {
    const response = await fetch(getApiUrl("/api/auth/bootstrap-user"), {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      console.warn("[Auth] User bootstrap returned", response.status, error?.message || error?.error || "");
      return false;
    }
    return true;
  } catch (error) {
    console.error("[MSAL] User bootstrap failed after redirect:", error);
    return false;
  }
}

async function getKeycloakBootstrapBearerToken(redirectBearerToken?: string): Promise<string | undefined> {
  return redirectBearerToken || getKeycloakBearerToken() || (await refreshKeycloakToken()) || undefined;
}

function clearMsalRedirectHash() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  if (hash && (hash.includes("code=") || hash.includes("error="))) {
    window.history.replaceState(
      null,
      document.title,
      window.location.pathname + window.location.search,
    );
  }
}

async function bootstrapMsalApp() {
  const resolvedConfig = await resolveMsalConfiguration();
  const msalInstance = new PublicClientApplication(resolvedConfig);
  await msalInstance.initialize();

  const redirectResponse = await msalInstance.handleRedirectPromise().catch((error) => {
    console.error("[MSAL] Redirect handling failed:", error);
    return null;
  });

  const oidcProviderName = getOidcProviderName();
  const keycloakRedirect = await handleKeycloakRedirect().catch((error) => {
    console.error(`[${oidcProviderName}] Redirect handling failed:`, error);
    storeKeycloakError(error);
    return { handled: false } satisfies KeycloakRedirectResult;
  });

  if (keycloakRedirect.handled) {
    resetSessionExpired();
    const token = await getKeycloakBootstrapBearerToken(keycloakRedirect.bearerToken);
    if (token) {
      const bootstrapped = await bootstrapAuthenticatedUser(token);
      if (bootstrapped) {
        window.history.replaceState(null, "", "/overview");
      } else {
        clearKeycloakSession();
        storeKeycloakError(`${oidcProviderName} sign-in could not bootstrap the app user.`);
        window.history.replaceState(null, "", "/");
      }
    } else {
      clearKeycloakSession();
      storeKeycloakError(`${oidcProviderName} sign-in did not return a usable token.`);
      window.history.replaceState(null, "", "/");
    }
  }

  if (redirectResponse?.account) {
    msalInstance.setActiveAccount(redirectResponse.account);
    resetSessionExpired();
    clearMsalRedirectHash();
    void bootstrapAuthenticatedUser(redirectResponse.idToken);
  } else {
    const [existingAccount] = msalInstance.getAllAccounts();
    if (existingAccount) {
      msalInstance.setActiveAccount(existingAccount);
    }
  }

  initApiInterceptor(msalInstance);
  console.log("[Auth] MSAL/Azure AD mode active");

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>,
  );
}

async function bootstrapKeycloakApp() {
  const oidcProviderName = getOidcProviderName();
  const keycloakRedirect = await handleKeycloakRedirect().catch((error) => {
    console.error(`[${oidcProviderName}] Redirect handling failed:`, error);
    storeKeycloakError(error);
    return { handled: false } satisfies KeycloakRedirectResult;
  });

  if (keycloakRedirect.handled) {
    resetSessionExpired();
    const token = await getKeycloakBootstrapBearerToken(keycloakRedirect.bearerToken);
    if (token) {
      const bootstrapped = await bootstrapAuthenticatedUser(token);
      if (bootstrapped) {
        window.history.replaceState(null, "", "/overview");
      } else {
        clearKeycloakSession();
        storeKeycloakError(`${oidcProviderName} sign-in could not bootstrap the app user.`);
        window.history.replaceState(null, "", "/");
      }
    } else {
      clearKeycloakSession();
      storeKeycloakError(`${oidcProviderName} sign-in did not return a usable token.`);
      window.history.replaceState(null, "", "/");
    }
  }

  if (!keycloakRedirect.handled && isKeycloakAuthenticated() && !getKeycloakBearerToken()) {
    const refreshedToken = await refreshKeycloakToken();
    if (!refreshedToken) {
      clearKeycloakSession();
      resetSessionExpired();
    }
  }

  initApiInterceptor(noopMsalInstance);
  console.log(`[Auth] ${oidcProviderName}/OIDC mode active`);

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <MsalContext.Provider
      value={{
        instance: noopMsalInstance,
        inProgress: InteractionStatus.None,
        accounts: [],
        logger: console as any,
      }}
    >
      <App />
    </MsalContext.Provider>,
  );
}

if (amplifyMode) {
  void bootstrapAmplifyApp();
} else if (keycloakMode) {
  void bootstrapKeycloakApp().catch((error) => {
    console.error("[Auth] Keycloak bootstrap failed:", error);
    storeKeycloakError(error);
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML =
        "<div style=\"padding:2rem;font-family:sans-serif;max-width:40rem\">" +
        "<h1>Sign-in configuration error</h1>" +
        "<p>Set <code>DEVX_AUTH_MODE=keycloak</code>, <code>VITE_AUTH_MODE=keycloak</code>, " +
        "<code>OIDC_ISSUER</code>, <code>OIDC_CLIENT_ID</code>, <code>VITE_OIDC_AUTHORITY</code>, and " +
        "<code>VITE_OIDC_CLIENT_ID</code>, then restart the app.</p>" +
        "</div>";
    }
  });
} else {
  void bootstrapMsalApp().catch((error) => {
    console.error("[Auth] MSAL bootstrap failed:", error);
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML =
        "<div style=\"padding:2rem;font-family:sans-serif;max-width:40rem\">" +
        "<h1>Sign-in configuration error</h1>" +
        "<p>Set <code>AZURE_AD_CLIENT_ID</code> and <code>AZURE_AD_TENANT_ID</code> in AWS Secrets Manager " +
        "(secret <code>devx/platform/qa</code>), then restart pods. See docs/deployment/CLIENT_MSAL_EKS_SETUP.md.</p>" +
        "</div>";
    }
  });
}
