/**
 * Error normalization utilities
 * Converts various error formats (Azure DevOps, HTTP, network) into a consistent NormalizedError format
 */

import type {
  NormalizedError,
  ErrorCode,
  ErrorAction,
  AzureDevOpsErrorResponse,
} from "@/types/errors";

/**
 * Safely stringify an object, handling circular references and errors
 */
export function safeStringify(obj: unknown): string {
  try {
    if (typeof obj === "string") return obj;
    if (obj === null || obj === undefined) return "";
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Extract project name from Azure DevOps error message
 * Example: "TF200019: The following project already exists on the Azure DevOps Server: AgFirst"
 * Returns: "AgFirst"
 */
export function extractProjectName(message: string): string | null {
  if (!message) return null;

  // Pattern: "project already exists...: ProjectName"
  const match = message.match(/already exists[^:]*:\s*([^\s,\.]+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Pattern: "project 'ProjectName' already exists"
  const match2 = message.match(/project\s+['"]?([^'"]+)['"]?\s+already exists/i);
  if (match2 && match2[1]) {
    return match2[1].trim();
  }

  return null;
}

/**
 * Remove TF error codes from messages (e.g., "TF200019: message" -> "message")
 */
export function humanizeTfError(message: string): string {
  if (!message) return "";
  // Remove TF codes like "TF200019: " or "TF12345: "
  return message.replace(/^TF\d+:\s*/i, "").trim();
}

/**
 * Parse Azure DevOps error response
 */
function parseAzureDevOpsError(
  error: unknown
): AzureDevOpsErrorResponse | null {
  if (!error) return null;

  try {
    // If it's already an object
    if (typeof error === "object") {
      const obj = error as Record<string, unknown>;
      // Check if it has Azure DevOps error structure
      if (obj.error || obj.details || obj.typeKey) {
        return obj as AzureDevOpsErrorResponse;
      }
    }

    // If it's a string, try to parse it
    if (typeof error === "string") {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(error);
        if (parsed.error || parsed.details || parsed.typeKey) {
          return parsed as AzureDevOpsErrorResponse;
        }
      } catch {
        // Not JSON, check if it contains Azure DevOps error structure
        if (error.includes("Azure DevOps") || error.includes("TF")) {
          return { error, message: error };
        }
      }
    }

    // Check if error has a response property (Axios-like)
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error
    ) {
      const axiosError = error as { response?: { data?: unknown } };
      if (axiosError.response?.data) {
        return parseAzureDevOpsError(axiosError.response.data);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract HTTP status code from various error formats
 */
function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  // Axios error structure
  if ("response" in error) {
    const axiosError = error as { response?: { status?: number } };
    return axiosError.response?.status;
  }

  // Fetch Response object
  if ("status" in error) {
    return (error as { status: number }).status;
  }

  // Error with status property
  if ("status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }

  return undefined;
}

export function normalizeError(error: unknown): NormalizedError {
  // If already normalized, return as is
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "title" in error &&
    "message" in error
  ) {
    return error as NormalizedError;
  }

  const httpStatus = extractHttpStatus(error);
  const adoError = parseAzureDevOpsError(error);

  // Handle Azure DevOps specific errors
  if (adoError) {
    // Parse details - it might be double-encoded JSON string
    let detailsJson: any = null;
    if (adoError.details) {
      try {
        // First parse
        let firstParse: any;
        if (typeof adoError.details === "string") {
          firstParse = JSON.parse(adoError.details);
        } else {
          firstParse = adoError.details;
        }
        
        // If it's still a string, parse again (double-encoded)
        if (typeof firstParse === "string") {
          try {
            // Handle escaped JSON strings like: "{\"message\":\"TF200019: ...\"}"
            const unescaped = firstParse.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
            detailsJson = JSON.parse(unescaped);
          } catch {
            // If second parse fails, try parsing the original string after unescaping
            try {
              const unescaped = adoError.details.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
              detailsJson = JSON.parse(unescaped);
            } catch {
              // Last resort: extract message from string using regex
              // Try multiple patterns to handle escaped JSON
              let messageMatch = firstParse.match(/"message"\s*:\s*"([^"]+)"/);
              if (!messageMatch) {
                // Try with escaped quotes
                messageMatch = firstParse.match(/\\"message\\"\s*:\s*\\"([^"]+)"/);
              }
              if (!messageMatch) {
                // Try to find "message" followed by colon and quoted string (handling escapes)
                messageMatch = firstParse.match(/(?:message|"message"|\\"message\\")\s*[:=]\s*(?:\\")?([^"\\]+)(?:\\")?/);
              }
              if (messageMatch && messageMatch[1]) {
                detailsJson = { message: messageMatch[1] };
              } else {
                // Try to extract "already exists" pattern directly
                const alreadyExistsMatch = firstParse.match(/already exists[^:]*:\s*([^\s,\.]+)/i);
                if (alreadyExistsMatch && alreadyExistsMatch[1]) {
                  detailsJson = { message: firstParse };
                } else {
                  detailsJson = { message: firstParse };
                }
              }
            }
          }
        } else {
          detailsJson = firstParse;
        }
      } catch {
        // If parsing fails completely, try to extract message directly from string using regex
        if (typeof adoError.details === "string") {
          // Try multiple regex patterns to extract message from escaped JSON
          let messageMatch = adoError.details.match(/"message"\s*:\s*"([^"]+)"/);
          if (!messageMatch) {
            // Try with escaped quotes
            messageMatch = adoError.details.match(/\\"message\\"\s*:\s*\\"([^"]+)"/);
          }
          if (!messageMatch) {
            // Try more flexible pattern for escaped JSON
            messageMatch = adoError.details.match(/(?:message|"message"|\\"message\\")\s*[:=]\s*(?:\\")?([^"\\]+)(?:\\")?/);
          }
          if (!messageMatch) {
            // Try to find TF code followed by message
            messageMatch = adoError.details.match(/TF\d+:\s*([^"]+)/i);
          }
          
          if (messageMatch && messageMatch[1]) {
            detailsJson = { message: messageMatch[1] };
          } else {
            // Check if it contains "already exists" pattern - extract project name
            const alreadyExistsMatch = adoError.details.match(/already exists[^:]*:\s*([^\s,\.]+)/i);
            if (alreadyExistsMatch && alreadyExistsMatch[1]) {
              detailsJson = { message: adoError.details };
            } else {
              detailsJson = { message: adoError.details };
            }
          }
        } else {
          detailsJson = { message: String(adoError.details) };
        }
      }
    }

    const errorMessage =
      detailsJson?.message || adoError.message || adoError.error || "";
    const typeKey = detailsJson?.typeKey || adoError.typeKey || "";
    const humanizedMessage = humanizeTfError(errorMessage);

    // Project already exists
    if (
      typeKey === "ProjectAlreadyExistsException" ||
      humanizedMessage.toLowerCase().includes("project already exists")
    ) {
      const projectName = extractProjectName(errorMessage) || "this name";
      return {
        code: "PROJECT_ALREADY_EXISTS",
        httpStatus: httpStatus || 400,
        title: "Project Already Exists",
        message: `A project with the name "${projectName}" already exists. Please choose a different name.`,
        details: adoError,
        retryable: false,
        action: "CHANGE_INPUT",
      };
    }

    // Generic Azure DevOps validation error
    if (httpStatus === 400 || typeKey.includes("Exception")) {
      return {
        code: "VALIDATION_ERROR",
        httpStatus: httpStatus || 400,
        title: "Validation Error",
        message: humanizedMessage || "Please check your input and try again.",
        details: adoError,
        retryable: false,
        action: "CHANGE_INPUT",
      };
    }
  }

  // Handle HTTP status codes
  if (httpStatus) {
    switch (httpStatus) {
      case 400: {
        const data = (error as any)?.response?.data;
        const serverMessage = error instanceof Error ? error.message : (data?.message || data?.error);
        return {
          code: "VALIDATION_ERROR",
          httpStatus: 400,
          title: "Invalid Request",
          message: serverMessage || "Please check your input and try again.",
          details: error,
          retryable: false,
          action: "CHANGE_INPUT",
        };
      }

      case 401:
        return {
          code: "UNAUTHORIZED",
          httpStatus: 401,
          title: "Authentication Required",
          message: "Your session has expired. Please sign in and try again.",
          details: error,
          retryable: false,
          action: "LOGIN",
        };

      case 403:
        return {
          code: "FORBIDDEN",
          httpStatus: 403,
          title: "Access Denied",
          message: "You do not have permission to perform this action.",
          details: error,
          retryable: false,
          action: "CONTACT_SUPPORT",
        };

      case 404:
        return {
          code: "NOT_FOUND",
          httpStatus: 404,
          title: "Not Found",
          message: "The requested resource could not be found.",
          details: error,
          retryable: false,
        };

      case 409:
        return {
          code: "CONFLICT",
          httpStatus: 409,
          title: "Conflict",
          message:
            "A conflicting resource already exists. Please choose a different value.",
          details: error,
          retryable: false,
          action: "CHANGE_INPUT",
        };

      case 412: {
        const data = (error as any)?.response?.data;
        const serverMessage =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.error === "string"
              ? data.error
              : undefined;
        return {
          code: "VALIDATION_ERROR",
          httpStatus: 412,
          title: "Setup Required",
          message: serverMessage || "A required setup step is missing.",
          details: error,
          retryable: false,
          action: "CHANGE_INPUT",
        };
      }

      case 429:
        return {
          code: "RATE_LIMITED",
          httpStatus: 429,
          title: "Too Many Requests",
          message:
            "You are sending requests too quickly. Please wait a moment and try again.",
          details: error,
          retryable: true,
          action: "RETRY",
        };

      case 500:
      case 502:
      case 503:
      case 504: {
        const data = (error as any)?.response?.data;
        const serverDetails = typeof data?.details === "string" ? data.details : data?.error;
        const message =
          serverDetails ||
          "The service is currently unavailable. Please try again shortly.";
        return {
          code: "SERVER_ERROR",
          httpStatus,
          title: "Server Error",
          message,
          details: error,
          retryable: true,
          action: "RETRY",
        };
      }
    }
  }

  // Handle network errors (no HTTP status)
  if (
    error instanceof TypeError &&
    (error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("Failed to fetch"))
  ) {
    return {
      code: "NETWORK_ERROR",
      title: "Connection Error",
      message:
        "Unable to reach the service. Check your connection and try again.",
      details: error,
      retryable: true,
      action: "RETRY",
    };
  }

  // Handle Error objects
  if (error instanceof Error) {
    const message = error.message || "Something went wrong.";
    return {
      code: "UNKNOWN_ERROR",
      httpStatus,
      title: "Error",
      message: message.includes("TF") ? humanizeTfError(message) : message,
      details: error,
      retryable: false,
    };
  }

  // Default fallback
  return {
    code: "UNKNOWN_ERROR",
    httpStatus,
    title: "Error",
    message: "Something went wrong. Please try again or contact support.",
    details: error,
    retryable: false,
    action: "CONTACT_SUPPORT",
  };
}
