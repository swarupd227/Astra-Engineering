import { getApiUrlAtRuntime } from "./api-config";

const QE_BASE = "/qe";

function isHostedSwa(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host.endsWith(".azurestaticapps.net") || host === "devx.nousinfo.com";
}

/** True when the path is an API route (not a static/QE asset path). */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Resolve a relative or same-origin `/api/*` URL to the App Service on hosted
 * SWA, or keep relative `/api/*` on localhost and co-hosted deploys (EKS, Hilti).
 */
export function resolveQeApiUrl(url: string): string {
  if (!url || url.startsWith("http://") || url.startsWith("https://")) {
    if (!isHostedSwa() || !url) return url;
    try {
      const parsed = new URL(url);
      const onCurrentOrigin = parsed.origin === window.location.origin;
      if (onCurrentOrigin && isApiPath(parsed.pathname)) {
        return getApiUrlAtRuntime(`${parsed.pathname}${parsed.search}`);
      }
    } catch {
      /* keep original */
    }
    return url;
  }

  if (isApiPath(url.split("?")[0] ?? url)) {
    return getApiUrlAtRuntime(url);
  }

  return url;
}

/** Prefix non-API app paths with `/qe` when missing (QE router base). */
export function resolveQeAppPath(url: string): string {
  if (!url.startsWith("/") || url.startsWith(QE_BASE) || isApiPath(url.split("?")[0] ?? url)) {
    return url;
  }
  return `${QE_BASE}${url}`;
}
