import { fetchAuthSession } from "aws-amplify/auth";
import { clearStaleCognitoSession, hasValidCognitoIdToken } from "@/lib/cognito-session";

let sessionExpired = false;

const SELECTED_ORG_ID_STORAGE_KEY = "devx:selected-organization-id";
const SELECTED_ORG_NAME_STORAGE_KEY = "devx:selected-organization-name";

function attachOrganizationHeaders(headers: Headers): void {
  if (typeof window === "undefined") return;
  const orgId = window.sessionStorage.getItem(SELECTED_ORG_ID_STORAGE_KEY);
  const orgName = window.sessionStorage.getItem(SELECTED_ORG_NAME_STORAGE_KEY);
  if (orgId) headers.set("x-organization-id", orgId);
  if (orgName) headers.set("x-organization-name", orgName);
}

export function isAmplifySessionExpired(): boolean {
  return sessionExpired;
}

/** Clear after sign-out / sign-in so API calls work again without full page reload. */
export function resetAmplifySessionExpired(): void {
  sessionExpired = false;
}

function isPublicUnauthenticatedPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return (
    path === "/" ||
    path === "" ||
    path === "/auth/callback" ||
    path.startsWith("/auth/callback/")
  );
}

export async function addUserInfoToRequestAmplify(
  _url: string,
  options: RequestInit = {},
): Promise<RequestInit> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();
    if (idToken) {
      const headers = new Headers(options.headers);
      headers.set("Authorization", `Bearer ${idToken}`);
      headers.set("x-auth-provider", "cognito");
      attachOrganizationHeaders(headers);
      return { ...options, headers };
    }
  } catch { /* not signed in */ }
  return options;
}

const EXPIRED_RESPONSE = () =>
  new Response(JSON.stringify({ error: "Unauthorized", message: "Session expired" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Wrap fetch to attach Cognito ID token for /api requests (same contract as MSAL interceptor).
 */
export function initApiInterceptorAmplify(): void {
  sessionExpired = false;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const baseOptions = (typeof init === "object" ? init : {}) as RequestInit;

    if (!url.includes("/api") || url.includes("cognito") || url.includes("amazonaws.com")) {
      return originalFetch(input, init);
    }

    if (sessionExpired) {
      return EXPIRED_RESPONSE();
    }

    const existingHeaders = new Headers(baseOptions.headers);
    let enhanced: RequestInit = baseOptions;
    if (!existingHeaders.has("authorization")) {
      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        if (idToken) {
          const headers = new Headers(baseOptions.headers);
          headers.set("Authorization", `Bearer ${idToken}`);
          attachOrganizationHeaders(headers);
          enhanced = { ...baseOptions, headers };
        }
      } catch {
        /* not signed in */
      }
    }
    if (enhanced === baseOptions) {
      const headers = new Headers(baseOptions.headers);
      attachOrganizationHeaders(headers);
      enhanced = { ...baseOptions, headers };
    }

    let res = await originalFetch(input, { ...enhanced, credentials: "include" });

    // Do not forceRefresh here — stale refresh tokens cause Cognito 400 loops in the console.
    if (res.status === 401 && !sessionExpired) {
      const stillValid = await hasValidCognitoIdToken();
      if (!stillValid) {
        // On landing/callback, 401 without a token is expected — do not block future sign-in.
        if (isPublicUnauthenticatedPath()) {
          return res;
        }
        sessionExpired = true;
        console.warn("[Auth] API 401 — clearing stale Cognito session; sign in again.");
        await clearStaleCognitoSession();
        import("@/lib/queryClient").then(({ queryClient }) => queryClient.cancelQueries());
        if (typeof window !== "undefined" && window.location.pathname !== "/") {
          window.location.href = "/";
        }
      }
    }

    return res;
  };
}
