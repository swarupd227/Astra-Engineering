/**
 * Axios wrapper with normalized error handling
 * Note: This file is provided for projects using Axios.
 * If your project doesn't use Axios, you can ignore this file.
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from "axios";
import { normalizeError } from "@/utils/normalizeError";
import type { NormalizedError } from "@/types/errors";

/**
 * Log error to telemetry/console
 */
function logError(error: NormalizedError): void {
  if (process.env.NODE_ENV === "development") {
    console.error("[Error]", {
      code: error.code,
      httpStatus: error.httpStatus,
      title: error.title,
      message: error.message,
      details: error.details,
    });
  }
  // TODO: Send to telemetry service
}

/**
 * Create an Axios instance with error normalization interceptor
 */
export function createAxiosInstance(
  baseURL?: string,
  config?: AxiosRequestConfig
): AxiosInstance {
  const instance = axios.create({
    baseURL,
    ...config,
  });

  // Response interceptor to normalize errors
  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      // Normalize the error
      const normalized = normalizeError(error);
      logError(normalized);

      // Create a new error with normalized properties
      const normalizedError = new Error(normalized.message);
      Object.assign(normalizedError, normalized);
      throw normalizedError;
    }
  );

  return instance;
}

/**
 * Default Axios instance (can be configured with base URL)
 */
export const axiosInstance = createAxiosInstance();

/**
 * Convenience wrapper that returns data directly and throws normalized errors
 */
export async function axiosRequest<T = unknown>(
  config: AxiosRequestConfig
): Promise<T> {
  try {
    const response = await axiosInstance.request<T>(config);
    return response.data;
  } catch (error) {
    // Error is already normalized by interceptor
    throw error;
  }
}

