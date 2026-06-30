import { PublicClientApplication, AccountInfo } from "@azure/msal-browser";
import { loginRequest, azureManagementRequest } from "@/config/msalConfig";
import { isKeycloakAuthMode } from "@/lib/auth-mode";
import {
  clearKeycloakSession,
  getKeycloakBearerToken,
  getOidcProviderId,
  isKeycloakAuthenticated,
  refreshKeycloakToken,
} from "@/utils/keycloak-auth";

/**
 * Interceptor that attaches a validated Azure AD Bearer token to every API request.
 * The server only trusts cryptographically signed JWTs — no spoofable headers.
 *
 * Token acquisition is silent only (no popups — browsers block those from
 * non-user-initiated contexts).  On 401 the user is redirected to the
 * landing page once, where they can click "Sign In" (a real user gesture).
 */

let msalInstance: PublicClientApplication | null = null;
/** Once true, all API calls are blocked and the user is being redirected. */
let sessionExpired = false;
const SELECTED_ORG_ID_STORAGE_KEY = "devx:selected-organization-id";
const SELECTED_ORG_NAME_STORAGE_KEY = "devx:selected-organization-name";
const SESSION_EXPIRED_STORAGE_KEY = "devx:session-expired";

/** Check if session has expired (used by queryClient to bail early). */
export function isSessionExpired(): boolean {
  if (sessionExpired) return true;
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY) === "1";
}

/** Clear the session-expired latch after a successful interactive sign-in. */
export function resetSessionExpired(): void {
  sessionExpired = false;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
  }
}

/** Expose the MSAL instance for sign-out from non-React contexts (e.g. MFA dialog). */
export function getMsalInstance(): PublicClientApplication | null {
  return msalInstance;
}

/** Synthetic 401 response returned to callers after session expires. */
const EXPIRED_RESPONSE = () =>
  new Response(JSON.stringify({ error: "Unauthorized", message: "Session expired" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Initialize the interceptor with MSAL instance.
 * Wraps global fetch so ALL API requests automatically include the Bearer token.
 */
export function initApiInterceptor(instance: PublicClientApplication) {
  msalInstance = instance;
  sessionExpired = false;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const baseOptions = (typeof init === "object" ? init : {}) as RequestInit;

    // Only intercept our own API calls
    if (!url.includes("/api")) {
      return originalFetch(input, baseOptions);
    }
    if (url.includes("/api/auth/oidc/refresh") || url.includes("/api/auth/keycloak/refresh")) {
      return originalFetch(input, baseOptions);
    }

    const hasKeycloakSession = isKeycloakAuthenticated();
    const account = hasKeycloakSession ? null : getCurrentAccount();

    if (!hasKeycloakSession && !account) {
      // Wait up to 3s for MSAL to restore the account after page refresh.
      // If it never appears the user is genuinely logged out — let the request
      // proceed without a token so the server's 401 triggers the normal redirect.
      await new Promise<void>((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
          if (getCurrentAccount() || Date.now() - start > 3000) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }

    // Block all API calls once session is expired — prevents cascade of 401s
    if (sessionExpired) {
      return EXPIRED_RESPONSE();
    }

    // Skip token injection when the caller (apiRequest / defaultQueryFn) already added
    // an Authorization header via addUserInfoToRequest.  Calling acquireTokenSilent
    // twice per request is redundant and can occasionally race with MSAL's token cache.
    const existingHeaders = new Headers(baseOptions.headers);
    const enhanced = existingHeaders.has("authorization")
      ? baseOptions
      : await addBearerToken(baseOptions);
    let res = await originalFetch(input, enhanced);

    // On 401, always retry with a *force-refreshed* token — bypasses any stale cache.
    if (res.status === 401 && !sessionExpired) {
      await new Promise((r) => setTimeout(r, 1000));
      const retryOptions = await addBearerToken(baseOptions, true);
      res = await originalFetch(input, retryOptions);
    }

    if (res.status === 401 && !sessionExpired) {
      // Only treat as a true session expiry when MSAL itself has no accounts — meaning
      // the user is genuinely logged out.  In that case cancel in-flight queries so the
      // UI stops hammering a dead session.  We do NOT hard-navigate here: MSAL React
      // (useIsAuthenticated → ProtectedRoute) will detect the auth-state change and
      // redirect to "/" on its own, avoiding the false-redirect race condition that
      // occurred when we navigated from an async fetch callback.
      //
      // When accounts still exist (transient 401 — network hiccup, MSAL cache miss,
      // brief token-refresh window) we let the response propagate so the caller's
      // onError handler can show a toast; future requests are NOT blocked.
      const accounts = msalInstance?.getAllAccounts() ?? [];
      if (accounts.length === 0 && !isKeycloakAuthenticated()) {
        sessionExpired = true;
        import("@/lib/queryClient").then(({ queryClient }) => queryClient.cancelQueries());
      }
    }

    return res;
  };
}

/**
 * Get current authenticated account from MSAL
 */
function getCurrentAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  try {
    const accounts = msalInstance.getAllAccounts();
    return accounts.length > 0 ? accounts[0] : null;
  } catch (error) {
    console.error("[API Interceptor] Error getting MSAL account:", error);
    return null;
  }
}

/** Buffer window: if a cached token expires within this many ms, force a refresh. */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
/** Acquire an access token silently from MSAL.
 * No popups — if silent renewal fails the request proceeds without a token
 * and the 401 handler will handle the failure.
 *
 * @param account  The MSAL account to acquire for.
 * @param forceRefresh  Skip the cache entirely and fetch a new token from Azure AD.
 */
async function acquireAccessToken(
  account: AccountInfo,
  forceRefresh = false,
): Promise<string | null> {
  if (!msalInstance) return null;
  try {
    const response = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account,
      forceRefresh,
    });

    // If the cached token is close to expiry, proactively fetch a fresh one
    // so we never send a token that expires in-flight.
    if (!forceRefresh && response.expiresOn) {
      const remainingMs = response.expiresOn.getTime() - Date.now();
      if (remainingMs < TOKEN_REFRESH_BUFFER_MS) {
        const fresh = await msalInstance.acquireTokenSilent({
          ...loginRequest,
          account,
          forceRefresh: true,
        });
        return fresh.accessToken || null;
      }
    }

    return response.accessToken || null;
  } catch (err) {
    console.debug("[API Interceptor] acquireAccessToken failed:", err);
    return null;
  }
}

/** Acquire an ID token silently from MSAL.
 * This is used because the server currently validates ID tokens (audience = app client id).
 */
async function acquireIdToken(
  account: AccountInfo,
  forceRefresh = false,
): Promise<string | null> {
  if (!msalInstance) return null;
  try {
    // Request OIDC scopes to obtain an ID token
    const idRequest = {
      scopes: ["openid", "profile", "email"],
      account,
      forceRefresh,
    } as any;

    const response = await msalInstance.acquireTokenSilent(idRequest);
    // response.idToken may be present
    if (response && (response as any).idToken) return (response as any).idToken;
    return null;
  } catch (err) {
    console.debug("[API Interceptor] acquireIdToken failed:", err);
    return null;
  }
}

/**
 * Attach the Bearer token to fetch options.
 * @param forceRefresh  When true, bypasses MSAL cache to get a brand-new token.
 */
async function addBearerToken(
  options: RequestInit = {},
  forceRefresh = false,
): Promise<RequestInit> {
  try {
    if (isKeycloakAuthMode()) {
      let keycloakToken = getKeycloakBearerToken();
      // For OIDC/Keycloak, normal requests use the cached access token. A 401
      // retry forces one refresh through refreshKeycloakToken's single-flight
      // promise so concurrent requests do not rotate the refresh token multiple times.
      if ((forceRefresh || !keycloakToken) && isKeycloakAuthenticated()) {
        keycloakToken = await refreshKeycloakToken();
        if (!keycloakToken && isKeycloakAuthenticated()) {
          clearKeycloakSession();
          sessionExpired = true;
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, "1");
          }
        }
      }
      if (keycloakToken) {
        const headers = new Headers(options.headers);
        headers.set("Authorization", `Bearer ${keycloakToken}`);
        headers.set("x-auth-provider", getOidcProviderId());
        addSelectedOrganizationHeaders(headers);
        return { ...options, headers };
      }
    }

    const account = getCurrentAccount();
    if (!account) return options;

    // Prefer ID token (server validates ID tokens by audience). Fall back to access token.
    const idToken = await acquireIdToken(account, forceRefresh);
    const tokenToUse = idToken ?? (await acquireAccessToken(account, forceRefresh));
    if (!tokenToUse) return options;

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${tokenToUse}`);

    if (account.tenantId) {
      headers.set("x-tenant-id", account.tenantId);
    }

    addSelectedOrganizationHeaders(headers);

    return { ...options, headers };
  } catch (error) {
    console.error("[API Interceptor] Error adding Bearer token:", error);
    return options;
  }
}

function addSelectedOrganizationHeaders(headers: Headers): void {
  if (typeof window === "undefined") return;

  const selectedOrganizationId = window.sessionStorage.getItem(SELECTED_ORG_ID_STORAGE_KEY);
  const selectedOrganizationName = window.sessionStorage.getItem(SELECTED_ORG_NAME_STORAGE_KEY);

  if (selectedOrganizationId) {
    headers.set("x-organization-id", selectedOrganizationId);
  }

  if (selectedOrganizationName) {
    headers.set("x-organization-name", selectedOrganizationName);
  }
}

/**
 * Acquire an Azure Resource Management access token for the current user.
 * Used by provisioning flows that need to call Azure RM APIs server-side.
 */
export async function acquireAzureManagementToken(): Promise<string | null> {
  if (!msalInstance) return null;
  const account = getCurrentAccount();
  if (!account) return null;
  try {
    const response = await msalInstance.acquireTokenSilent({
      ...azureManagementRequest,
      account,
    });
    return response.accessToken || null;
  } catch {
    return null;
  }
}

/**
 * Public helper kept for backward compatibility.
 */
export async function addUserInfoToRequest(
  _url: string,
  options: RequestInit = {}
): Promise<RequestInit> {
  return addBearerToken(options);
}
