/**
 * Polaris machine-to-machine JWT verification.
 *
 * DevX is the VERIFIER only — Polaris holds the private key and signs; we hold
 * the matching public key (from .env) and validate signature + claims.
 *
 * Contract (RS256):
 *   header  { alg: "RS256", kid: "polaris-key3567", typ: "JWT" }
 *   payload { iss: "polaris", aud: "devx-metrics", sub: "polaris-backend",
 *             scope: "metrics.read", iat, exp }   exp - iat <= 300s
 *
 * Key source (public key only), in priority order:
 *   1. POLARIS_JWKS_URI       — remote JWKS (key published under the kid)
 *   2. POLARIS_JWT_PUBLIC_KEY — static SPKI PEM in .env
 *
 * Authorization validates the caller; it derives NO tenant and applies NO
 * tenant scoping.
 */
import type { Request, Response, NextFunction } from "express";
import {
  importSPKI,
  jwtVerify,
  createRemoteJWKSet,
  type JWTVerifyGetKey,
  type CryptoKey,
} from "jose";

const POLARIS_ISSUER = "polaris";
const POLARIS_AUDIENCE = "devx-metrics";
const POLARIS_SUBJECT = "polaris-backend";
const POLARIS_REQUIRED_SCOPE = "metrics.read";
const POLARIS_KID = "polaris-key3567";
const POLARIS_ALG = "RS256";
// Polaris spec is 300s. Override via env for local/long-lived test tokens; keep
// the default at 300 in production.
const MAX_LIFETIME_SEC = Number(process.env.POLARIS_MAX_TOKEN_LIFETIME_SEC) || 300;
const CLOCK_TOLERANCE_SEC = 30;

export interface PolarisClaims {
  sub: string;
  scope: string;
}

/** Error subclass so the middleware can map insufficient-scope to 403 vs 401. */
class PolarisAuthError extends Error {
  constructor(message: string, readonly forbidden = false) {
    super(message);
    this.name = "PolarisAuthError";
  }
}

// ── Key resolution (cached) ──
let _jwks: JWTVerifyGetKey | null = null;
let _publicKey: CryptoKey | null = null;
let _publicKeyPromise: Promise<CryptoKey> | null = null;

function normalizePem(raw: string): string {
  // .env values often carry literal "\n" rather than real newlines.
  return raw.includes("-----BEGIN") && raw.includes("\\n")
    ? raw.replace(/\\n/g, "\n")
    : raw;
}

function getJwks(): JWTVerifyGetKey | null {
  const uri = process.env.POLARIS_JWKS_URI?.trim();
  if (!uri) return null;
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(uri), {
      timeoutDuration: 10_000,
      cooldownDuration: 5_000,
    });
  }
  return _jwks;
}

async function getStaticPublicKey(): Promise<CryptoKey> {
  if (_publicKey) return _publicKey;
  if (!_publicKeyPromise) {
    const pem = process.env.POLARIS_JWT_PUBLIC_KEY?.trim();
    if (!pem) {
      throw new PolarisAuthError(
        "Polaris public key not configured (set POLARIS_JWT_PUBLIC_KEY or POLARIS_JWKS_URI)",
      );
    }
    _publicKeyPromise = importSPKI(normalizePem(pem), POLARIS_ALG).then((k) => {
      _publicKey = k;
      return k;
    });
  }
  return _publicKeyPromise;
}

/** Reset cached keys — used by tests that swap the configured key at runtime. */
export function _resetPolarisKeyCacheForTests(): void {
  _jwks = null;
  _publicKey = null;
  _publicKeyPromise = null;
}

// ── Validated-token cache (5 min), mirrors jwt-validator.ts ──
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const _tokenCache = new Map<string, { claims: PolarisClaims; expiresAt: number }>();

function cacheKey(token: string): string {
  return token.slice(-32);
}

/**
 * Verify a Polaris JWT and return its claims. Throws PolarisAuthError on any
 * failure (signature, claims, expiry, lifetime, scope).
 */
export async function verifyPolarisToken(token: string): Promise<PolarisClaims> {
  const ck = cacheKey(token);
  const cached = _tokenCache.get(ck);
  if (cached && Date.now() < cached.expiresAt) return cached.claims;
  if (cached) _tokenCache.delete(ck);

  const jwks = getJwks();
  const key = jwks ?? (await getStaticPublicKey());

  let payload: Record<string, any>;
  let header: Record<string, any>;
  try {
    const result = await jwtVerify(token, key as any, {
      issuer: POLARIS_ISSUER,
      audience: POLARIS_AUDIENCE,
      algorithms: [POLARIS_ALG],
      clockTolerance: CLOCK_TOLERANCE_SEC,
    });
    payload = result.payload as Record<string, any>;
    header = result.protectedHeader as Record<string, any>;
  } catch (err) {
    throw new PolarisAuthError(`token verification failed: ${(err as Error).message}`);
  }

  // kid: JWKS enforces it during key selection; for a static PEM, assert it.
  if (!jwks && header.kid && header.kid !== POLARIS_KID) {
    throw new PolarisAuthError(`invalid kid: ${header.kid}`);
  }
  if (payload.sub !== POLARIS_SUBJECT) {
    throw new PolarisAuthError(`invalid sub: ${payload.sub}`);
  }
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (!iat || !exp) throw new PolarisAuthError("token missing iat/exp");
  if (exp - iat > MAX_LIFETIME_SEC) {
    throw new PolarisAuthError(`token lifetime ${exp - iat}s exceeds ${MAX_LIFETIME_SEC}s`);
  }

  // scope present but insufficient → forbidden (403)
  const scope = String(payload.scope ?? "");
  if (!scope.split(/\s+/).filter(Boolean).includes(POLARIS_REQUIRED_SCOPE)) {
    throw new PolarisAuthError(`missing required scope '${POLARIS_REQUIRED_SCOPE}'`, true);
  }

  const claims: PolarisClaims = { sub: String(payload.sub), scope };
  _tokenCache.set(ck, { claims, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  if (_tokenCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _tokenCache) if (now >= v.expiresAt) _tokenCache.delete(k);
  }
  return claims;
}

export interface PolarisRequest extends Request {
  polaris?: PolarisClaims;
}

/**
 * Express middleware. 401 for missing/invalid token, 403 for valid token that
 * lacks the required scope.
 */
export async function requirePolarisAuth(
  req: PolarisRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Bearer token required" });
    return;
  }
  const token = header.substring(7).trim();
  try {
    req.polaris = await verifyPolarisToken(token);
    next();
  } catch (err) {
    if (err instanceof PolarisAuthError && err.forbidden) {
      res.status(403).json({ error: "forbidden", message: err.message });
      return;
    }
    console.warn("[PolarisAuth] rejected:", (err as Error).message);
    res.status(401).json({ error: "unauthorized" });
  }
}
