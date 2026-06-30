// API Configuration
/** Local Express dev: use same-origin `/api/*` so synthetic test data and other routes always hit this server (avoids 404 from hosted APIs missing newer paths). */
function isLocalOrLanDevHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  // RFC1918 — `npm run dev` bound to 0.0.0.0, opened as http://192.168.x.x:PORT
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h)) return true;
  return false;
}

// Environment-specific backend URLs
const ENV_BACKEND_URLS = {
  qa: 'https://qadevxapi2o-epb8aubyd0btefeg.eastus2-01.azurewebsites.net',
  uat: 'https://uatdevxapi2o-e3cthkekghbyg5f3.eastus2-01.azurewebsites.net',
  prod: 'https://devxapi2o-emfrddb9bab5hkdb.eastus2-01.azurewebsites.net',
  studio: 'https://devxstudioapi-f2d7eagegxh6aaf2.centralus-01.azurewebsites.net',
  'insurity-prod': 'https://insuritydevexapiprod2-eecpapbtdsh5dpfj.eastus2-01.azurewebsites.net',
  'insurity-sandbox': 'https://insurityapi2o-hndqecdge5ama9g6.eastus2-01.azurewebsites.net',
} as const;

/**
 * Determines the current environment and returns the appropriate backend URL
 * Priority:
 * 1. VITE_API_BASE_URL (manual override)
 * 2. Local browser (localhost / 127.0.0.1) → same-origin only (empty string), so QE + main app always hit the dev Express server even if VITE_ENVIRONMENT is set in .env
 * 3. VITE_ENVIRONMENT (qa, uat, prod)
 * 4. Hostname detection (if running in browser)
 * 5. Empty string (relative URLs)
 */
function getBackendBaseUrl(): string {
  // Type assertion for Vite environment variables
  const viteEnv = import.meta.env as {
    VITE_API_BASE_URL?: string;
    VITE_ENVIRONMENT?: string;
  };

  // 1. Manual override via environment variable (see getApiUrl for local/LAN same-origin override)
  if (viteEnv.VITE_API_BASE_URL) {
    return viteEnv.VITE_API_BASE_URL;
  }

  // 2. Local / LAN dev: never point at remote Azure APIs from hostname heuristics or VITE_ENVIRONMENT
  if (typeof window !== "undefined" && window.location?.hostname) {
    if (isLocalOrLanDevHost(window.location.hostname)) {
      return "";
    }
  }

  // 3. Check for explicit environment variable
  const env = viteEnv.VITE_ENVIRONMENT?.toLowerCase();
  if (
    env &&
    (env === 'qa' ||
      env === 'uat' ||
      env === 'prod' ||
      env === 'studio' ||
      env === 'insurity-prod' ||
      env === 'insurity-sandbox')
  ) {
    return ENV_BACKEND_URLS[env as keyof typeof ENV_BACKEND_URLS];
  }

  // 4. Try to detect from hostname (if running in browser)
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname.toLowerCase();

    // Check for Azure Static Web App hostnames (avoid broad "qa" substring — matches PC names and forces wrong API → 404)
    // QA: gentle-hill-099ce5400
    if (hostname.includes('gentle-hill-099ce5400') || hostname.includes('qadevx')) {
      return ENV_BACKEND_URLS.qa;
    }

    // UAT: polite-sky-06c4dc20f
    if (hostname.includes('polite-sky-06c4dc20f') || hostname.includes('uatdevx')) {
      return ENV_BACKEND_URLS.uat;
    }

    // Insurity PROD: black-ground-04780b10f
    if (hostname.includes('black-ground-04780b10f') || (hostname.includes('insurity') && !hostname.includes('sandbox'))) {
      return ENV_BACKEND_URLS['insurity-prod'];
    }

    // Insurity SANDBOX: gray-sand-0533b2c00
    if (hostname.includes('gray-sand-0533b2c00') || hostname.includes('insurity-sandbox')) {
      return ENV_BACKEND_URLS['insurity-sandbox'];
    }

    // Studio: devx.nousinfo.com
    if (hostname.includes('devx.nousinfo.com')) {
      return ENV_BACKEND_URLS.studio;
    }

    // PROD: orange-sky-04d093200
    if (hostname.includes('orange-sky-04d093200') || (hostname.includes('devxapi2o') && !hostname.includes('qa') && !hostname.includes('uat') && !hostname.includes('insurity'))) {
      return ENV_BACKEND_URLS.prod;
    }
  }

  // 5. Default: same-origin / relative URLs
  return '';
}

// Export the base URL (computed once at load; getApiUrl re-evaluates base when needed for local dev)
export const API_BASE_URL = getBackendBaseUrl();

/** Origin for Socket.IO — same host as the REST API when remote; page origin in local / same-origin dev. */
function getSocketBaseUrl(): string {
  const base = getBackendBaseUrl();
  if (base) {
    const trimmed = base.replace(/\/+$/, "");
    try {
      return new URL(trimmed).origin;
    } catch {
      return trimmed;
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export const SOCKET_BASE_URL = getSocketBaseUrl();

// Helper function to build full API URL
export function getApiUrl(path: string): string {
  // Remove leading slash if present to avoid double slashes
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  let base = getBackendBaseUrl();

  // Even if VITE_API_BASE_URL points at a hosted API, use same-origin when the UI is local/LAN dev so
  // `/api/testing/*` hits Express (hosted backends often 404 on routes only in this repo).
  if (
    base &&
    typeof window !== "undefined" &&
    window.location?.hostname &&
    isLocalOrLanDevHost(window.location.hostname)
  ) {
    base = "";
  }

  if (base) {
    // Remove trailing slash from base URL if present, then add path with leading slash
    const baseUrl = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${baseUrl}/${cleanPath}`;
  }

  return `/${cleanPath}`;
}

/** True when `/api/*` is served from the same origin as the UI (local, App Service, CDN, custom co-hosted). */
export function isCoHostedApiOrigin(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    isLocalOrLanDevHost(host) ||
    host.endsWith(".azurewebsites.net") ||
    host.endsWith(".cloudfront.net") ||
    host.endsWith(".hilti.com")
  );
}

function buildApiUrl(path: string, baseUrl: string): string {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  if (baseUrl) {
    const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}/${cleanPath}`;
  }
  return `/${cleanPath}`;
}

/** Resolve API URL at request time — co-hosted origins stay relative; SWA targets App Service. */
export function getApiUrlAtRuntime(path: string): string {
  if (typeof window === "undefined") {
    return getApiUrl(path);
  }

  const hostname = window.location.hostname.toLowerCase();
  if (isCoHostedApiOrigin(hostname)) {
    return buildApiUrl(path, "");
  }

  const isHostedSwa =
    hostname.endsWith(".azurestaticapps.net") || hostname === "devx.nousinfo.com";
  if (isHostedSwa) {
    let base = getBackendBaseUrl();
    if (
      base &&
      typeof window !== "undefined" &&
      window.location?.hostname &&
      isLocalOrLanDevHost(window.location.hostname)
    ) {
      base = "";
    }
    if (!base) base = ENV_BACKEND_URLS.qa;
    return buildApiUrl(path, base);
  }

  return getApiUrl(path);
}

