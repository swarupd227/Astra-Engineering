/**
 * Safe wrappers around `window.localStorage` that never throw.
 *
 * Browsers throw `QuotaExceededError` (DOMException) when the per-origin
 * localStorage quota (~5 MB in most browsers) is exceeded. If this happens
 * inside a React render path (e.g. inside a `useEffect`), the error bubbles
 * up to the nearest ErrorBoundary and crashes the whole page.
 *
 * These helpers categorise the failure so callers can choose to:
 *   - silently degrade (skip persistence),
 *   - surface a toast,
 *   - fall back to IndexedDB (see `./idb-storage`).
 */

export type SafeSetResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "unavailable" | "unknown"; error?: unknown };

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  // Standard, Firefox, code-based (legacy)
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function safeSetItem(key: string, value: string): SafeSetResult {
  if (!hasLocalStorage()) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    window.localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) {
      return { ok: false, reason: "quota", error: err };
    }
    return { ok: false, reason: "unknown", error: err };
  }
}

export function safeGetItem(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeRemoveItem(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore — nothing actionable
  }
}

export function safeSetJson(key: string, value: unknown): SafeSetResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (err) {
    return { ok: false, reason: "unknown", error: err };
  }
  return safeSetItem(key, serialized);
}

export function safeGetJson<T>(key: string): T | null {
  const raw = safeGetItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
