import { getApiUrl } from "@/lib/api-config";

const KEYCLOAK_TOKEN_STORAGE_KEY = "devx:keycloak-token";
const KEYCLOAK_STATE_STORAGE_KEY = "devx:keycloak-state";
const KEYCLOAK_VERIFIER_STORAGE_KEY = "devx:keycloak-code-verifier";
const KEYCLOAK_LAST_ERROR_STORAGE_KEY = "devx:keycloak-last-error";
const KEYCLOAK_TRANSACTION_PREFIX = "devx:keycloak-pkce:";
const KEYCLOAK_TRANSACTION_TTL_MS = 30 * 60 * 1000;

type KeycloakTokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type StoredKeycloakToken = KeycloakTokenResponse & {
  expiresAt: number;
};

type KeycloakLoginTransaction = {
  state: string;
  verifier: string;
  createdAt: number;
};

export type KeycloakRedirectResult = {
  handled: boolean;
  bearerToken?: string;
};

export type KeycloakAccount = {
  provider: string;
  accountKey: string;
  displayName: string;
  email: string;
  subject: string;
};

function getEnv(name: string): string {
  return String((import.meta.env as Record<string, string | undefined>)[name] || "").trim();
}

function isEnabledValue(value: string): boolean {
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

function getFirstEnv(...names: string[]): string {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return value;
  }
  return "";
}

function getOidcClockToleranceMs(): number {
  const value = getFirstEnv(
    "VITE_OIDC_CLOCK_TOLERANCE_SECONDS",
    "VITE_KEYCLOAK_CLOCK_TOLERANCE_SECONDS",
  );
  if (!value) return 300_000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 300_000;
  return Math.min(Math.floor(parsed), 31_536_000) * 1000;
}

export function getOidcProviderId(): string {
  const explicit = getFirstEnv("VITE_OIDC_PROVIDER_ID", "VITE_KEYCLOAK_PROVIDER_ID");
  if (explicit) return explicit;
  const providerName = getFirstEnv("VITE_OIDC_PROVIDER_NAME", "VITE_KEYCLOAK_PROVIDER_NAME");
  return providerName ? providerName.toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "keycloak";
}

export function getOidcProviderName(): string {
  return getFirstEnv("VITE_OIDC_PROVIDER_NAME", "VITE_KEYCLOAK_PROVIDER_NAME") || "Keycloak";
}

function getAuthority(): string {
  return getFirstEnv("VITE_OIDC_AUTHORITY", "VITE_KEYCLOAK_AUTHORITY").replace(/\/+$/, "");
}

function getClientId(): string {
  return getFirstEnv("VITE_OIDC_CLIENT_ID", "VITE_KEYCLOAK_CLIENT_ID");
}

function getRedirectUri(): string {
  return getFirstEnv("VITE_OIDC_REDIRECT_URI", "VITE_KEYCLOAK_REDIRECT_URI") || window.location.origin + "/";
}

function getScope(): string {
  return getFirstEnv("VITE_OIDC_SCOPE", "VITE_KEYCLOAK_SCOPE") || "openid profile email";
}

function getAuthorizationEndpoint(): string {
  const configured = getFirstEnv(
    "VITE_OIDC_AUTHORIZATION_ENDPOINT",
    "VITE_KEYCLOAK_AUTHORIZATION_ENDPOINT",
  );
  if (configured) return configured;
  const authority = getAuthority();
  return /\/realms\//.test(authority)
    ? `${authority}/protocol/openid-connect/auth`
    : `${authority}/authorize`;
}

function getLogoutEndpoint(): string {
  const configured = getFirstEnv("VITE_OIDC_LOGOUT_ENDPOINT", "VITE_KEYCLOAK_LOGOUT_ENDPOINT");
  if (configured) return configured;
  const authority = getAuthority();
  return /\/realms\//.test(authority)
    ? `${authority}/protocol/openid-connect/logout`
    : `${authority}/v2/logout`;
}

function getPostLogoutRedirectUri(): string {
  return (
    getFirstEnv(
      "VITE_OIDC_POST_LOGOUT_REDIRECT_URI",
      "VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI",
    ) ||
    getRedirectUri().replace(/\/+$/, "") ||
    window.location.origin + "/"
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getTokenExpiryMs(token: string): number | null {
  const claims = decodeJwtPayload(token);
  return typeof claims?.exp === "number" ? claims.exp * 1000 : null;
}

function readStoredToken(): StoredKeycloakToken | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(KEYCLOAK_TOKEN_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredKeycloakToken;
  } catch {
    window.sessionStorage.removeItem(KEYCLOAK_TOKEN_STORAGE_KEY);
    return null;
  }
}

function storageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota/privacy failures; the sessionStorage legacy keys below
    // still cover the normal single-tab callback flow.
  }
}

function storageRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage privacy failures.
  }
}

function storageKeys(storage: Storage): string[] {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index) || "").filter(Boolean);
  } catch {
    return [];
  }
}

function transactionStorageKey(state: string): string {
  return `${KEYCLOAK_TRANSACTION_PREFIX}${state}`;
}

function writeKeycloakLoginTransaction(transaction: KeycloakLoginTransaction): void {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(transaction);
  const key = transactionStorageKey(transaction.state);
  storageSet(window.sessionStorage, key, serialized);
  storageSet(window.localStorage, key, serialized);
}

function parseKeycloakLoginTransaction(raw: string | null): KeycloakLoginTransaction | null {
  if (!raw) return null;
  try {
    const transaction = JSON.parse(raw) as KeycloakLoginTransaction;
    if (!transaction?.state || !transaction?.verifier || typeof transaction.createdAt !== "number") {
      return null;
    }
    if (Date.now() - transaction.createdAt > KEYCLOAK_TRANSACTION_TTL_MS) {
      return null;
    }
    return transaction;
  } catch {
    return null;
  }
}

function readKeycloakLoginTransaction(state: string): KeycloakLoginTransaction | null {
  if (typeof window === "undefined") return null;
  const key = transactionStorageKey(state);
  const transaction =
    parseKeycloakLoginTransaction(storageGet(window.sessionStorage, key)) ||
    parseKeycloakLoginTransaction(storageGet(window.localStorage, key));
  if (transaction) return transaction;

  const expectedState = storageGet(window.sessionStorage, KEYCLOAK_STATE_STORAGE_KEY);
  const verifier = storageGet(window.sessionStorage, KEYCLOAK_VERIFIER_STORAGE_KEY);
  if (expectedState === state && verifier) {
    return { state, verifier, createdAt: Date.now() };
  }
  return null;
}

function removeKeycloakLoginTransaction(state?: string | null): void {
  if (typeof window === "undefined") return;
  if (state) {
    const key = transactionStorageKey(state);
    storageRemove(window.sessionStorage, key);
    storageRemove(window.localStorage, key);
  }
  const expectedState = storageGet(window.sessionStorage, KEYCLOAK_STATE_STORAGE_KEY);
  if (!state || expectedState === state) {
    storageRemove(window.sessionStorage, KEYCLOAK_STATE_STORAGE_KEY);
    storageRemove(window.sessionStorage, KEYCLOAK_VERIFIER_STORAGE_KEY);
  }
}

function removeAllKeycloakLoginTransactions(): void {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    storageKeys(storage)
      .filter((key) => key.startsWith(KEYCLOAK_TRANSACTION_PREFIX))
      .forEach((key) => storageRemove(storage, key));
  }
  storageRemove(window.sessionStorage, KEYCLOAK_STATE_STORAGE_KEY);
  storageRemove(window.sessionStorage, KEYCLOAK_VERIFIER_STORAGE_KEY);
}

function clearOidcCallbackParams(url: URL): void {
  ["code", "state", "session_state", "iss"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function readStoredTokenValue(key: "id_token" | "access_token", allowStale = false): string | null {
  const token = readStoredToken();
  const value = token?.[key];
  if (!value) return null;
  const expiresAt = getTokenExpiryMs(value) ?? token.expiresAt;
  if (!allowStale && Date.now() >= expiresAt + getOidcClockToleranceMs() - 30_000) {
    return null;
  }
  return value;
}

function normalizeTokenResponse(token: KeycloakTokenResponse & Record<string, unknown>): KeycloakTokenResponse {
  return {
    access_token: token.access_token || (typeof token.accessToken === "string" ? token.accessToken : undefined),
    id_token: token.id_token || (typeof token.idToken === "string" ? token.idToken : undefined),
    refresh_token:
      token.refresh_token || (typeof token.refreshToken === "string" ? token.refreshToken : undefined),
    expires_in: token.expires_in || (typeof token.expiresIn === "number" ? token.expiresIn : undefined),
    token_type: token.token_type || (typeof token.tokenType === "string" ? token.tokenType : undefined),
  };
}

function writeStoredToken(token: KeycloakTokenResponse): void {
  const normalized = normalizeTokenResponse(token as KeycloakTokenResponse & Record<string, unknown>);
  const existingToken = readStoredToken();
  const idToken = normalized.id_token || existingToken?.id_token;
  const accessToken = normalized.access_token || existingToken?.access_token;
  if (!idToken && !accessToken) {
    throw new Error(`${getOidcProviderName()} token response did not include a usable token.`);
  }

  const tokenForExpiry = normalized.access_token || normalized.id_token || accessToken || idToken;
  const tokenExpiryMs = tokenForExpiry ? getTokenExpiryMs(tokenForExpiry) : null;
  const expMs =
    tokenExpiryMs !== null
      ? tokenExpiryMs
      : Date.now() + Math.max(normalized.expires_in || 300, 30) * 1000;

  window.sessionStorage.setItem(
    KEYCLOAK_TOKEN_STORAGE_KEY,
    JSON.stringify({
      ...existingToken,
      ...normalized,
      id_token: idToken,
      access_token: accessToken,
      refresh_token: normalized.refresh_token || existingToken?.refresh_token,
      expiresAt: expMs,
    }),
  );
}

export function isKeycloakConfigured(): boolean {
  if (typeof window === "undefined") return false;
  const authMode = getEnv("VITE_AUTH_MODE").toLowerCase();
  return (
    (authMode === "keycloak" ||
      authMode === "oidc" ||
      isEnabledValue(getEnv("VITE_OIDC_ENABLED")) ||
      isEnabledValue(getEnv("VITE_KEYCLOAK_ENABLED"))) &&
    Boolean(getAuthority()) &&
    Boolean(getClientId())
  );
}

export function isKeycloakRedirectResponse(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const issuer = params.get("iss") || "";
  const issuerMatches = !issuer || issuer.replace(/\/+$/, "") === getAuthority();
  return Boolean(params.get("code") && params.get("state") && issuerMatches);
}

export async function loginWithKeycloak(): Promise<void> {
  if (!isKeycloakConfigured()) {
    throw new Error(`${getOidcProviderName()} sign-in is not configured.`);
  }
  const state = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  window.sessionStorage.setItem(KEYCLOAK_STATE_STORAGE_KEY, state);
  window.sessionStorage.setItem(KEYCLOAK_VERIFIER_STORAGE_KEY, verifier);
  writeKeycloakLoginTransaction({ state, verifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: getScope(),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(`${getAuthorizationEndpoint()}?${params.toString()}`);
}

export async function handleKeycloakRedirect(): Promise<KeycloakRedirectResult> {
  if (!isKeycloakConfigured() || !isKeycloakRedirectResponse()) return { handled: false };

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    clearOidcCallbackParams(url);
    throw new Error(`Invalid ${getOidcProviderName()} sign-in response.`);
  }
  const transaction = readKeycloakLoginTransaction(state);
  if (!transaction?.verifier) {
    clearOidcCallbackParams(url);
    throw new Error(
      `${getOidcProviderName()} sign-in state could not be matched. Start sign-in again from localhost:4000.`,
    );
  }

  const response = await fetch(getApiUrl("/api/auth/oidc/exchange"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, codeVerifier: transaction.verifier, redirectUri: getRedirectUri() }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    removeKeycloakLoginTransaction(state);
    clearOidcCallbackParams(url);
    throw new Error(error?.message || `${getOidcProviderName()} token exchange failed (${response.status}).`);
  }

  const tokenResponse = normalizeTokenResponse(
    (await response.json()) as KeycloakTokenResponse & Record<string, unknown>,
  );
  writeStoredToken(tokenResponse);
  window.sessionStorage.removeItem(KEYCLOAK_LAST_ERROR_STORAGE_KEY);
  removeKeycloakLoginTransaction(state);
  clearOidcCallbackParams(url);
  return { handled: true, bearerToken: tokenResponse.access_token || tokenResponse.id_token };
}

/**
 * Local "Dev Login": ask the backend to mint a session via the OIDC password
 * grant and store it like a normal login. Only works when the server has
 * DEVX_DEV_LOGIN enabled (local dev). No browser redirect involved.
 */
export async function devLoginKeycloak(): Promise<void> {
  const response = await fetch(getApiUrl("/api/auth/oidc/dev-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || `Dev login failed (${response.status}).`);
  }
  const tokenResponse = normalizeTokenResponse(
    (await response.json()) as KeycloakTokenResponse & Record<string, unknown>,
  );
  writeStoredToken(tokenResponse);
}

export function storeKeycloakError(error: unknown): void {
  if (typeof window === "undefined") return;
  const message =
    error instanceof Error ? error.message : String(error || `${getOidcProviderName()} sign-in failed.`);
  window.sessionStorage.setItem(KEYCLOAK_LAST_ERROR_STORAGE_KEY, message);
}

export function consumeKeycloakError(): string | null {
  if (typeof window === "undefined") return null;
  const message = window.sessionStorage.getItem(KEYCLOAK_LAST_ERROR_STORAGE_KEY);
  window.sessionStorage.removeItem(KEYCLOAK_LAST_ERROR_STORAGE_KEY);
  return message;
}

export function getKeycloakIdToken(allowStale = false): string | null {
  return readStoredTokenValue("id_token", allowStale);
}

export function getKeycloakAccessToken(allowStale = false): string | null {
  return readStoredTokenValue("access_token", allowStale);
}

export function getKeycloakBearerToken(allowStale = false): string | null {
  return getKeycloakAccessToken(allowStale) || getKeycloakIdToken(allowStale);
}

export function isKeycloakAuthenticated(): boolean {
  const token = readStoredToken();
  return Boolean(token?.id_token || token?.access_token || token?.refresh_token);
}

export function getKeycloakAccount(): KeycloakAccount | null {
  const token = getKeycloakIdToken(true) || getKeycloakAccessToken(true);
  if (!token) return null;
  const claims = decodeJwtPayload(token);
  const subject = String(claims?.sub || "");
  if (!subject) return null;
  const email = String(claims?.email || claims?.preferred_username || "");
  const displayName = String(claims?.name || claims?.preferred_username || email || `${getOidcProviderName()} User`);
  const provider = getOidcProviderId();
  return { provider, accountKey: `${provider}:${subject}`, displayName, email, subject };
}

let keycloakRefreshPromise: Promise<string | null> | null = null;

export async function refreshKeycloakToken(): Promise<string | null> {
  const storedToken = readStoredToken();
  if (!storedToken?.refresh_token) return null;
  if (!keycloakRefreshPromise) {
    keycloakRefreshPromise = fetch(getApiUrl("/api/auth/oidc/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refreshToken: storedToken.refresh_token }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        writeStoredToken((await response.json()) as KeycloakTokenResponse);
        return getKeycloakBearerToken();
      })
      .catch(() => null)
      .finally(() => {
        keycloakRefreshPromise = null;
      });
  }
  const token = await keycloakRefreshPromise;
  if (!token && !getKeycloakBearerToken()) clearKeycloakSession();
  return token;
}

export function clearKeycloakSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(KEYCLOAK_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(KEYCLOAK_LAST_ERROR_STORAGE_KEY);
  removeAllKeycloakLoginTransactions();
}

export function logoutKeycloak(): void {
  const idToken = getKeycloakIdToken();
  clearKeycloakSession();
  const setting = getFirstEnv(
    "VITE_OIDC_PROVIDER_LOGOUT_ENABLED",
    "VITE_KEYCLOAK_PROVIDER_LOGOUT_ENABLED",
  );
  const shouldLogoutAtProvider = setting === "" || isEnabledValue(setting);
  if (!isKeycloakConfigured() || !shouldLogoutAtProvider) {
    window.location.assign("/");
    return;
  }

  const params = new URLSearchParams({
    post_logout_redirect_uri: getPostLogoutRedirectUri(),
    client_id: getClientId(),
  });
  if (idToken) params.set("id_token_hint", idToken);
  window.location.assign(`${getLogoutEndpoint()}?${params.toString()}`);
}
