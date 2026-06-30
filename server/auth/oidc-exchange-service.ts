import { getFirstEnv, getOidcClientId, getOidcIssuer, isOidcEnabled } from "./oidc-config";

type OidcExchangeBody = {
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
};

type OidcRefreshBody = {
  refreshToken?: string;
};

let tokenEndpointPromise: Promise<string> | null = null;

function getOidcClientSecret(): string {
  return getFirstEnv("OIDC_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET");
}

function assertOidcConfigured() {
  if (!isOidcEnabled()) {
    const error = new Error("OIDC provider is not configured.");
    (error as any).status = 404;
    throw error;
  }
}

function parseRedirectUri(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // handled below
  }
  const error = new Error("Invalid Keycloak callback payload.");
  (error as any).status = 400;
  throw error;
}

async function getTokenEndpoint(): Promise<string> {
  const configured = getFirstEnv("OIDC_TOKEN_ENDPOINT", "KEYCLOAK_TOKEN_ENDPOINT");
  if (configured) return configured;

  if (!tokenEndpointPromise) {
    tokenEndpointPromise = fetch(`${getOidcIssuer()}/.well-known/openid-configuration`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
        const discovery = await response.json();
        if (!discovery?.token_endpoint) {
          throw new Error("OIDC discovery document is missing token_endpoint");
        }
        return String(discovery.token_endpoint);
      })
      .catch((error) => {
        tokenEndpointPromise = null;
        throw error;
      });
  }

  return tokenEndpointPromise;
}

export async function exchangeOidcCode(body: OidcExchangeBody) {
  assertOidcConfigured();
  const code = String(body.code || "").trim();
  const codeVerifier = String(body.codeVerifier || "").trim();
  const redirectUri = parseRedirectUri(String(body.redirectUri || "").trim());
  if (!code || !codeVerifier) {
    const error = new Error("Invalid Keycloak callback payload.");
    (error as any).status = 400;
    throw error;
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getOidcClientId(),
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const clientSecret = getOidcClientSecret();
  if (clientSecret) form.set("client_secret", clientSecret);

  const response = await fetch(await getTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;

  const message =
    payload?.error_description || payload?.error || `OIDC token exchange failed (${response.status}).`;
  const error = new Error(message);
  (error as any).status = 401;
  throw error;
}

/**
 * Local "Dev Login": mint a session via the OIDC password grant (no browser
 * redirect). Gated by DEVX_DEV_LOGIN — OFF by default, intended for local dev
 * where the browser can't reach the IdP redirect URL. Never enable in prod.
 */
export function isDevLoginEnabled(): boolean {
  const v = String(process.env.DEVX_DEV_LOGIN || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function devLogin() {
  assertOidcConfigured();
  if (!isDevLoginEnabled()) {
    const error = new Error("Dev login is disabled.");
    (error as any).status = 404;
    throw error;
  }
  const username = getFirstEnv("DEVX_DEV_LOGIN_USERNAME") || "dev";
  const password = getFirstEnv("DEVX_DEV_LOGIN_PASSWORD") || "dev";
  const form = new URLSearchParams({
    grant_type: "password",
    client_id: getOidcClientId(),
    username,
    password,
    scope: "openid profile email",
  });
  const clientSecret = getOidcClientSecret();
  if (clientSecret) form.set("client_secret", clientSecret);

  const response = await fetch(await getTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;

  const message =
    payload?.error_description || payload?.error || `Dev login failed (${response.status}).`;
  const error = new Error(message);
  (error as any).status = 401;
  throw error;
}

export async function refreshOidcTokens(body: OidcRefreshBody) {
  assertOidcConfigured();
  const refreshToken = String(body.refreshToken || "").trim();
  if (!refreshToken) {
    const error = new Error("Refresh token is required.");
    (error as any).status = 400;
    throw error;
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: getOidcClientId(),
    refresh_token: refreshToken,
  });
  const clientSecret = getOidcClientSecret();
  if (clientSecret) form.set("client_secret", clientSecret);

  const response = await fetch(await getTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;

  const message =
    payload?.error_description || payload?.error || `OIDC token refresh failed (${response.status}).`;
  const error = new Error(message);
  (error as any).status = 401;
  throw error;
}
