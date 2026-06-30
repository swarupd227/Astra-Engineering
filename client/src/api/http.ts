/**
 * Fetch wrapper with normalized error handling
 */

import { normalizeError } from "@/utils/normalizeError";
import type { NormalizedError } from "@/types/errors";

export interface HttpRequestOptions extends RequestInit {
  skipErrorNormalization?: boolean;
}

/**
 * Log error to telemetry/console (can be extended to send to logging service)
 */
function logError(error: NormalizedError): void {
  // Log to console in development
  if (process.env.NODE_ENV === "development") {
    console.error("[Error]", {
      code: error.code,
      httpStatus: error.httpStatus,
      title: error.title,
      message: error.message,
      // Only log details in dev, not in production to avoid PII leaks
      details: error.details,
    });
  }

  // TODO: Send to telemetry service (e.g., Sentry, LogRocket)
  // telemetryService.logError(error);
}

/**
 * Enhanced fetch wrapper with error normalization
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<T> {
  const { skipErrorNormalization, ...fetchOptions } = options;

  try {
    const response = await fetch(url, fetchOptions);

    // Handle non-OK responses
    if (!response.ok) {
      let errorData: unknown;
      const contentType = response.headers.get("content-type");

      try {
        if (contentType?.includes("application/json")) {
          errorData = await response.json();
        } else {
          const text = await response.text();
          errorData = text || response.statusText;
        }
      } catch {
        errorData = response.statusText || `HTTP ${response.status}`;
      }

      // Create error object with response info
      const error = {
        response: {
          status: response.status,
          statusText: response.statusText,
          data: errorData,
        },
        message: typeof errorData === "string" ? errorData : safeStringify(errorData),
      };

      if (skipErrorNormalization) {
        throw error;
      }

      const normalized = normalizeError(error);
      logError(normalized);
      throw normalized;
    }

    // Parse response
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    // If already normalized, re-throw
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    // Normalize and throw
    if (skipErrorNormalization) {
      throw error;
    }

    const normalized = normalizeError(error);
    logError(normalized);
    throw normalized;
  }
}

function safeStringify(obj: unknown): string {
  try {
    if (typeof obj === "string") return obj;
    if (obj === null || obj === undefined) return "";
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const http = {
  get: <T = unknown>(url: string, options?: HttpRequestOptions) =>
    httpRequest<T>(url, { ...options, method: "GET" }),

  post: <T = unknown>(url: string, data?: unknown, options?: HttpRequestOptions) =>
    httpRequest<T>(url, {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T = unknown>(url: string, data?: unknown, options?: HttpRequestOptions) =>
    httpRequest<T>(url, {
      ...options,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T = unknown>(url: string, data?: unknown, options?: HttpRequestOptions) =>
    httpRequest<T>(url, {
      ...options,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T = unknown>(url: string, options?: HttpRequestOptions) =>
    httpRequest<T>(url, { ...options, method: "DELETE" }),
};

