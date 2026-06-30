/**
 * Normalized error types for consistent error handling across the application
 */

export type ErrorCode =
  | "PROJECT_ALREADY_EXISTS"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "UNKNOWN_ERROR";

export type ErrorAction = "RETRY" | "CHANGE_INPUT" | "CONTACT_SUPPORT" | "LOGIN";

export interface NormalizedError {
  code: ErrorCode;
  httpStatus?: number;
  title: string;
  message: string;
  details?: unknown;
  retryable: boolean;
  action?: ErrorAction;
}

/**
 * Azure DevOps error response structure
 */
export interface AzureDevOpsErrorResponse {
  error?: string;
  details?: string;
  message?: string;
  typeKey?: string;
  typeName?: string;
}

