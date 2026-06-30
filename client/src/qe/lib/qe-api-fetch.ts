import { resolveQeApiUrl } from "./resolve-qe-api-url";

/**
 * Fetch helper for QE API calls on hosted SWA URLs.
 *
 * Resolves `/api/*` to the App Service at call time. On localhost and
 * co-hosted deploys, paths stay relative.
 */
export async function qeApiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = resolveQeApiUrl(normalizedPath);

  const fetchFn =
    typeof window !== "undefined" ? window.fetch.bind(window) : fetch;

  return fetchFn(url, {
    credentials: "include",
    ...init,
    headers: init?.headers,
  });
}

/** Parse JSON or throw a clear error when the server returned HTML (hosted mis-route). */
export async function parseQeApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (/^\s*</.test(text)) {
      throw new Error(
        "API returned HTML instead of JSON. The request may have hit the static site host instead of the API server, or the backend route is not deployed yet.",
      );
    }
    throw new Error(text.slice(0, 200) || "Invalid API response");
  }
}
