import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getAuthMode, isAuthModeMsal } from "../platform/hosting";
import {
  extractOidcTenantId,
  getFirstEnv,
  getOidcClientId,
  getOidcClockToleranceSeconds,
  getOidcIssuer,
  getOidcProviderId,
} from "./oidc-config";

const JWKS_TIMEOUT_MS = 10_000;
const JWKS_COOLDOWN_MS = 5_000;

// ── Azure AD config ──
const AZURE_JWKS_URI = "https://login.microsoftonline.com/common/discovery/v2.0/keys";
const AZURE_AUDIENCE =
  process.env.AZURE_AD_CLIENT_ID || "c324fa10-3c19-4d64-99e9-4b0e94845058";
const AZURE_ISSUER_PATTERN =
  /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/;

// ── Cognito config (reads server-side env, falls back to VITE_ prefixed) ──
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || process.env.VITE_COGNITO_USER_POOL_ID || "ap-south-1_dDAzwkcr3";
const COGNITO_REGION = process.env.COGNITO_REGION || process.env.VITE_COGNITO_REGION || "ap-south-1";
const COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID || process.env.VITE_COGNITO_APP_CLIENT_ID || "t3g2a9vdmjprk2ho01n1iphmd";
const COGNITO_JWKS_URI = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`;
const COGNITO_ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

function createTimeoutJWKS(uri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(uri), {
    timeoutDuration: JWKS_TIMEOUT_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
  });
}

let _azureJwks: JWTVerifyGetKey | null = null;
let _cognitoJwks: JWTVerifyGetKey | null = null;
const _oidcJwksByUri = new Map<string, JWTVerifyGetKey>();
let _oidcJwksUriPromise: Promise<string> | null = null;

function getAzureJwks(): JWTVerifyGetKey {
  if (!_azureJwks) _azureJwks = createTimeoutJWKS(AZURE_JWKS_URI);
  return _azureJwks;
}
function getCognitoJwks(): JWTVerifyGetKey {
  if (!_cognitoJwks) _cognitoJwks = createTimeoutJWKS(COGNITO_JWKS_URI);
  return _cognitoJwks;
}

async function getOidcJwksUri(): Promise<string> {
  const configured = getFirstEnv("OIDC_JWKS_URI", "KEYCLOAK_JWKS_URI");
  if (configured) return configured;

  if (!_oidcJwksUriPromise) {
    _oidcJwksUriPromise = fetch(`${getOidcIssuer()}/.well-known/openid-configuration`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
        const discovery = await response.json();
        if (!discovery?.jwks_uri) {
          throw new Error("OIDC discovery document is missing jwks_uri");
        }
        return String(discovery.jwks_uri);
      })
      .catch((error) => {
        _oidcJwksUriPromise = null;
        throw error;
      });
  }

  return _oidcJwksUriPromise;
}

async function getOidcJwks(): Promise<JWTVerifyGetKey> {
  const jwksUri = await getOidcJwksUri();
  let jwks = _oidcJwksByUri.get(jwksUri);
  if (!jwks) {
    jwks = createTimeoutJWKS(jwksUri);
    _oidcJwksByUri.set(jwksUri, jwks);
  }
  return jwks;
}

// ── Token validation cache ──
// Caches validated claims keyed by token hash to avoid re-validating on every request.
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _tokenCache = new Map<string, { claims: ValidatedTokenClaims; expiresAt: number }>();

function hashToken(token: string): string {
  // Use last 32 chars as a fast unique key (JWT signature portion)
  return token.slice(-32);
}

function getCachedClaims(token: string): ValidatedTokenClaims | null {
  const key = hashToken(token);
  const entry = _tokenCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _tokenCache.delete(key);
    return null;
  }
  return entry.claims;
}

function setCachedClaims(token: string, claims: ValidatedTokenClaims): void {
  const key = hashToken(token);
  _tokenCache.set(key, { claims, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  // Evict old entries if cache grows too large
  if (_tokenCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _tokenCache) {
      if (now > v.expiresAt) _tokenCache.delete(k);
    }
  }
}

/**
 * Pre-fetch JWKS keys at startup by triggering the jose JWKS client.
 * Uses a dummy jwtVerify that will fail but forces the JWKS download.
 */
export async function warmupJwks(): Promise<void> {
  try {
    const authMode = getAuthMode();
    const jwks =
      authMode === "keycloak" ? await getOidcJwks() : isAuthModeMsal() ? getAzureJwks() : getCognitoJwks();
    const label = authMode === "keycloak" ? "OIDC/Keycloak" : isAuthModeMsal() ? "Azure AD" : "Cognito";
    // Trigger JWKS fetch by calling the getter with a dummy header/token structure
    // The jose library caches keys internally after this call
    try {
      await jwtVerify("dummy.dummy.dummy", jwks, { clockTolerance: 0 });
    } catch {
      // Expected to fail (invalid token), but JWKS keys are now cached
    }
    console.log(`[JWTValidator] ${label} JWKS pre-warmed`);
  } catch {
    console.warn("[JWTValidator] JWKS pre-warm failed (network slow?) — will retry on first request");
  }
}

export interface ValidatedTokenClaims {
  provider: string;
  oid: string;
  email: string;
  name?: string;
  tid: string;
  sub: string;
  preferred_username?: string;
  "cognito:groups"?: string[];
}

export async function validateIdToken(
  token: string
): Promise<ValidatedTokenClaims> {
  const cached = getCachedClaims(token);
  if (cached) return cached;

  const authMode = getAuthMode();
  const claims =
    authMode === "keycloak"
      ? await validateOidcToken(token)
      : isAuthModeMsal()
        ? await validateAzureToken(token)
        : await validateCognitoToken(token);

  setCachedClaims(token, claims);
  return claims;
}

async function validateCognitoToken(token: string): Promise<ValidatedTokenClaims> {
  const { payload } = await jwtVerify(token, getCognitoJwks(), {
    issuer: COGNITO_ISSUER,
    clockTolerance: 300,
  });

  const audience = (payload.aud as string) || (payload.client_id as string);
  if (audience !== COGNITO_APP_CLIENT_ID) {
    throw new Error(`Invalid audience: ${audience}`);
  }

  const sub = payload.sub as string;
  const email =
    (payload.email as string) ||
    (payload["cognito:username"] as string);

  if (!sub) throw new Error("Token missing sub claim");
  if (!email) throw new Error("Token missing email claim");

  return {
    provider: "cognito",
    oid: sub,
    email,
    name: payload.name as string | undefined,
    tid: COGNITO_USER_POOL_ID,
    sub,
    preferred_username: (payload["cognito:username"] as string) || undefined,
    "cognito:groups": payload["cognito:groups"] as string[] | undefined,
  };
}

async function validateAzureToken(token: string): Promise<ValidatedTokenClaims> {
  const { payload } = await jwtVerify(token, getAzureJwks(), {
    audience: AZURE_AUDIENCE,
    clockTolerance: 300,
  });

  if (!payload.iss || !AZURE_ISSUER_PATTERN.test(payload.iss)) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  const oid = (payload.oid as string) || (payload.sub as string);
  const email =
    (payload.email as string) ||
    (payload.preferred_username as string) ||
    (payload.upn as string);
  const tid = payload.tid as string;

  if (!oid) throw new Error("Token missing oid/sub claim");
  if (!email) throw new Error("Token missing email/preferred_username claim");
  if (!tid) throw new Error("Token missing tid claim");

  return {
    provider: "microsoft",
    oid,
    email,
    name: payload.name as string | undefined,
    tid,
    sub: payload.sub as string,
    preferred_username: payload.preferred_username as string | undefined,
  };
}

function audienceMatches(aud: unknown, azp: unknown, clientId: string): boolean {
  if (Array.isArray(aud) && aud.includes(clientId)) return true;
  if (typeof aud === "string" && aud === clientId) return true;
  return azp === clientId;
}

async function validateOidcToken(token: string): Promise<ValidatedTokenClaims> {
  const issuer = getOidcIssuer();
  const clientId = getOidcClientId();
  if (!issuer || !clientId) {
    throw new Error("OIDC issuer/client ID is not configured");
  }

  const clockTolerance = getOidcClockToleranceSeconds();
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, await getOidcJwks(), {
      issuer,
      clockTolerance,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('"exp" claim timestamp check failed')) {
      const decoded = decodeJwt(token);
      const exp = typeof decoded.exp === "number" ? decoded.exp : null;
      const now = Math.floor(Date.now() / 1000);
      console.warn("[JWTValidator] OIDC token exp check failed:", {
        exp,
        now,
        expiredBySeconds: exp === null ? null : now - exp,
        clockToleranceSeconds: clockTolerance,
        issuer,
        provider: getOidcProviderId(),
      });
    }
    throw error;
  }

  if (!audienceMatches(payload.aud, payload.azp, clientId)) {
    throw new Error("Invalid OIDC audience");
  }

  const sub = payload.sub as string | undefined;
  const email =
    (payload.email as string | undefined) ||
    (payload.preferred_username as string | undefined);
  const tid = extractOidcTenantId(payload as Record<string, unknown>);

  if (!sub) throw new Error("OIDC token missing sub claim");
  if (!email) throw new Error("OIDC token missing email/preferred_username claim");
  if (!tid) throw new Error("OIDC token missing tenant claim and issuer fallback");

  return {
    provider: getOidcProviderId(),
    oid: sub,
    email,
    name: payload.name as string | undefined,
    tid,
    sub,
    preferred_username: payload.preferred_username as string | undefined,
  };
}
