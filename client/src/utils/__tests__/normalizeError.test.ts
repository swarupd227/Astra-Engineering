/**
 * Unit tests for error normalization
 */

import { describe, it, expect } from "vitest";
import {
  normalizeError,
  extractProjectName,
  humanizeTfError,
} from "../normalizeError";
import type { NormalizedError } from "@/types/errors";

describe("normalizeError", () => {
  describe("Azure DevOps ProjectAlreadyExistsException", () => {
    it("should extract project name from Azure DevOps error", () => {
      const error = {
        error: "Azure DevOps rejected the request (400).",
        details: JSON.stringify({
          message:
            'TF200019: The following project already exists on the Azure DevOps Server: AgFirst. You cannot create a new project with the same name as an existing project.',
          typeKey: "ProjectAlreadyExistsException",
        }),
      };

      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("PROJECT_ALREADY_EXISTS");
      expect(normalized.httpStatus).toBe(400);
      expect(normalized.message).toContain('"AgFirst"');
      expect(normalized.message).toContain("already exists");
      expect(normalized.action).toBe("CHANGE_INPUT");
      expect(normalized.retryable).toBe(false);
    });

    it("should handle double-encoded JSON in details field", () => {
      // Simulating the actual error format from the network response
      const error = {
        error: "Azure DevOps rejected the request (400). Project name may already exist or request is invalid.",
        details: JSON.stringify({
          $id: "1",
          innerException: null,
          message: "TF200019: The following project already exists on the Azure DevOps Server: AgFirst"
        }),
        response: {
          status: 400,
          data: {
            error: "Azure DevOps rejected the request (400). Project name may already exist or request is invalid.",
            details: JSON.stringify({
              $id: "1",
              innerException: null,
              message: "TF200019: The following project already exists on the Azure DevOps Server: AgFirst"
            })
          }
        }
      };

      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("PROJECT_ALREADY_EXISTS");
      expect(normalized.httpStatus).toBe(400);
      expect(normalized.message).toContain('"AgFirst"');
      expect(normalized.message).toContain("already exists");
    });

    it("should handle escaped JSON string in details", () => {
      // Test with escaped JSON string like in the screenshot
      const escapedDetails = '{\\"$id\\":\\"1\\",\\"innerException\\":null,\\"message\\":\\"TF200019: The following project already exists on the Azure DevOps Server: AgFirst\\"}';
      const error = {
        error: "Azure DevOps rejected the request (400).",
        details: escapedDetails,
        response: {
          status: 400,
          data: {
            error: "Azure DevOps rejected the request (400).",
            details: escapedDetails
          }
        }
      };

      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("PROJECT_ALREADY_EXISTS");
      expect(normalized.httpStatus).toBe(400);
      expect(normalized.message).toContain("AgFirst");
    });

    it("should handle project name in different formats", () => {
      const error = {
        error: "Azure DevOps rejected the request (400).",
        details: JSON.stringify({
          message:
            "TF200019: Project 'MyProject' already exists on the server.",
          typeKey: "ProjectAlreadyExistsException",
        }),
      };

      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("PROJECT_ALREADY_EXISTS");
      expect(normalized.message).toContain('"MyProject"');
    });
  });

  describe("TF code stripping", () => {
    it("should remove TF codes from error messages", () => {
      const message = "TF200019: The project already exists";
      const humanized = humanizeTfError(message);
      expect(humanized).toBe("The project already exists");
      expect(humanized).not.toContain("TF200019");
    });

    it("should handle messages without TF codes", () => {
      const message = "The project already exists";
      const humanized = humanizeTfError(message);
      expect(humanized).toBe("The project already exists");
    });
  });

  describe("HTTP status code handling", () => {
    it("should handle 400 Bad Request", () => {
      const error = {
        response: { status: 400, data: "Invalid request" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("VALIDATION_ERROR");
      expect(normalized.httpStatus).toBe(400);
      expect(normalized.message).toBe("Please check your input and try again.");
      expect(normalized.action).toBe("CHANGE_INPUT");
    });

    it("should handle 401 Unauthorized", () => {
      const error = {
        response: { status: 401, data: "Unauthorized" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("UNAUTHORIZED");
      expect(normalized.httpStatus).toBe(401);
      expect(normalized.message).toContain("session has expired");
      expect(normalized.action).toBe("LOGIN");
    });

    it("should handle 403 Forbidden", () => {
      const error = {
        response: { status: 403, data: "Forbidden" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("FORBIDDEN");
      expect(normalized.httpStatus).toBe(403);
      expect(normalized.message).toContain("permission");
      expect(normalized.action).toBe("CONTACT_SUPPORT");
    });

    it("should handle 404 Not Found", () => {
      const error = {
        response: { status: 404, data: "Not Found" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("NOT_FOUND");
      expect(normalized.httpStatus).toBe(404);
      expect(normalized.message).toContain("could not be found");
    });

    it("should handle 409 Conflict", () => {
      const error = {
        response: { status: 409, data: "Conflict" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("CONFLICT");
      expect(normalized.httpStatus).toBe(409);
      expect(normalized.message).toContain("conflicting resource");
      expect(normalized.action).toBe("CHANGE_INPUT");
    });

    it("should handle 429 Rate Limited", () => {
      const error = {
        response: { status: 429, data: "Too Many Requests" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("RATE_LIMITED");
      expect(normalized.httpStatus).toBe(429);
      expect(normalized.message).toContain("too quickly");
      expect(normalized.retryable).toBe(true);
      expect(normalized.action).toBe("RETRY");
    });

    it("should handle 500 Server Error", () => {
      const error = {
        response: { status: 500, data: "Internal Server Error" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("SERVER_ERROR");
      expect(normalized.httpStatus).toBe(500);
      expect(normalized.message).toContain("unavailable");
      expect(normalized.retryable).toBe(true);
      expect(normalized.action).toBe("RETRY");
    });

    it("should handle 502 Bad Gateway", () => {
      const error = {
        response: { status: 502, data: "Bad Gateway" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("SERVER_ERROR");
      expect(normalized.httpStatus).toBe(502);
      expect(normalized.retryable).toBe(true);
    });

    it("should handle 503 Service Unavailable", () => {
      const error = {
        response: { status: 503, data: "Service Unavailable" },
      };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("SERVER_ERROR");
      expect(normalized.httpStatus).toBe(503);
      expect(normalized.retryable).toBe(true);
    });
  });

  describe("Network errors", () => {
    it("should handle network errors (no status)", () => {
      const error = new TypeError("Failed to fetch");
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("NETWORK_ERROR");
      expect(normalized.httpStatus).toBeUndefined();
      expect(normalized.message).toContain("Unable to reach");
      expect(normalized.retryable).toBe(true);
      expect(normalized.action).toBe("RETRY");
    });

    it("should handle fetch network errors", () => {
      const error = new Error("Network request failed");
      const normalized = normalizeError(error) as NormalizedError;

      // Should fall back to UNKNOWN_ERROR for generic Error objects
      expect(normalized.code).toBe("UNKNOWN_ERROR");
    });
  });

  describe("Unknown errors", () => {
    it("should handle unknown error types", () => {
      const error = { someUnknownProperty: "value" };
      const normalized = normalizeError(error) as NormalizedError;

      expect(normalized.code).toBe("UNKNOWN_ERROR");
      expect(normalized.message).toBe(
        "Something went wrong. Please try again or contact support."
      );
      expect(normalized.action).toBe("CONTACT_SUPPORT");
    });

    it("should handle null/undefined errors", () => {
      const normalized = normalizeError(null) as NormalizedError;

      expect(normalized.code).toBe("UNKNOWN_ERROR");
      expect(normalized.message).toBe(
        "Something went wrong. Please try again or contact support."
      );
    });
  });

  describe("extractProjectName", () => {
    it("should extract project name from standard format", () => {
      const message =
        "TF200019: The following project already exists on the Azure DevOps Server: AgFirst";
      const name = extractProjectName(message);
      expect(name).toBe("AgFirst");
    });

    it("should extract project name from quoted format", () => {
      const message = "Project 'MyProject' already exists";
      const name = extractProjectName(message);
      expect(name).toBe("MyProject");
    });

    it("should return null if no project name found", () => {
      const message = "Some other error message";
      const name = extractProjectName(message);
      expect(name).toBeNull();
    });
  });
});

