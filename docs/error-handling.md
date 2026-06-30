# Error Handling Documentation

## Overview

This document describes the error handling system for the application, which normalizes various error formats (Azure DevOps, HTTP, network) into a consistent, user-friendly format.

## Architecture

### Components

1. **Types** (`types/errors.ts`): Defines `NormalizedError` interface and error codes
2. **Normalization** (`utils/normalizeError.ts`): Core logic to convert errors to normalized format
3. **API Wrappers** (`api/http.ts`, `api/axios.ts`): HTTP clients with error normalization
4. **UI Component** (`components/ErrorBanner.tsx`): Reusable error display component

## Error Codes

| Code | Description | HTTP Status | Retryable | Action |
|------|-------------|-------------|-----------|--------|
| `PROJECT_ALREADY_EXISTS` | Project name already exists in Azure DevOps | 400 | No | `CHANGE_INPUT` |
| `VALIDATION_ERROR` | Invalid request data | 400 | No | `CHANGE_INPUT` |
| `UNAUTHORIZED` | Authentication required | 401 | No | `LOGIN` |
| `FORBIDDEN` | Insufficient permissions | 403 | No | `CONTACT_SUPPORT` |
| `NOT_FOUND` | Resource not found | 404 | No | - |
| `CONFLICT` | Conflicting resource exists | 409 | No | `CHANGE_INPUT` |
| `RATE_LIMITED` | Too many requests | 429 | Yes | `RETRY` |
| `SERVER_ERROR` | Server-side error (5xx) | 500-504 | Yes | `RETRY` |
| `NETWORK_ERROR` | Network connectivity issue | - | Yes | `RETRY` |
| `UNKNOWN_ERROR` | Unmapped error | - | No | `CONTACT_SUPPORT` |

## Error Mapping

### Azure DevOps Errors

Azure DevOps errors are parsed from the response structure:

```json
{
  "error": "Azure DevOps rejected the request (400).",
  "details": "{\"message\":\"TF200019: ...\",\"typeKey\":\"ProjectAlreadyExistsException\"}"
}
```

**Special Handling:**
- `ProjectAlreadyExistsException` → `PROJECT_ALREADY_EXISTS`
- Project name is extracted from the message
- TF codes (e.g., `TF200019`) are stripped from user-facing messages

### HTTP Status Codes

| Status | Code | User Message |
|--------|------|--------------|
| 400 | `VALIDATION_ERROR` | "Please check your input and try again." |
| 401 | `UNAUTHORIZED` | "Your session has expired. Please sign in and try again." |
| 403 | `FORBIDDEN` | "You do not have permission to perform this action." |
| 404 | `NOT_FOUND` | "The requested resource could not be found." |
| 409 | `CONFLICT` | "A conflicting resource already exists. Please choose a different value." |
| 429 | `RATE_LIMITED` | "You are sending requests too quickly. Please wait a moment and try again." |
| 500-504 | `SERVER_ERROR` | "The service is currently unavailable. Please try again shortly." |

### Network Errors

Network errors (no HTTP status) are detected by:
- `TypeError` with "fetch", "network", or "Failed to fetch" in message
- Mapped to `NETWORK_ERROR` with retry action

## Usage Examples

### Using ErrorBanner Component

```tsx
import { ErrorBanner } from "@/components/ErrorBanner";
import { normalizeError } from "@/utils/normalizeError";
import { useState } from "react";

function MyComponent() {
  const [error, setError] = useState<NormalizedError | null>(null);

  const handleAction = async () => {
    try {
      await someApiCall();
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  return (
    <div>
      <ErrorBanner
        error={error}
        onRetry={handleAction}
        onDismiss={() => setError(null)}
      />
      {/* Rest of component */}
    </div>
  );
}
```

### Using HTTP Wrapper

```tsx
import { http } from "@/api/http";

try {
  const data = await http.post("/api/create-project", projectData);
  // Handle success
} catch (error) {
  // Error is already normalized
  if (error.code === "PROJECT_ALREADY_EXISTS") {
    // Handle specific error
  }
}
```

### Using Axios Wrapper

```tsx
import { axiosInstance } from "@/api/axios";

try {
  const response = await axiosInstance.post("/api/create-project", projectData);
  // Handle success
} catch (error) {
  // Error is already normalized by interceptor
  console.log(error.code, error.message);
}
```

## UI Message Examples

### One-Line Messages

| Error Type | Example Message |
|------------|----------------|
| Project Already Exists | `A project with the name "AgFirst" already exists. Please choose a different name.` |
| Validation | `Please check your input and try again.` |
| Unauthorized | `Your session has expired. Please sign in and try again.` |
| Forbidden | `You do not have permission to perform this action.` |
| Not Found | `The requested resource could not be found.` |
| Conflict | `A conflicting resource already exists. Please choose a different value.` |
| Rate Limited | `You are sending requests too quickly. Please wait a moment and try again.` |
| Server Error | `The service is currently unavailable. Please try again shortly.` |
| Network | `Unable to reach the service. Check your connection and try again.` |
| Unknown | `Something went wrong. Please try again or contact support.` |

## Telemetry

Errors are logged with the following structure:

```typescript
{
  code: ErrorCode,
  httpStatus?: number,
  title: string,
  message: string,
  details?: unknown  // Only in development, not in production
}
```

**Note:** Details are only logged in development to avoid PII leaks in production.

## Best Practices

1. **Always normalize errors** before displaying to users
2. **Use ErrorBanner** for consistent error display
3. **Provide action buttons** (Retry, Login) when applicable
4. **Log errors** for debugging but don't expose technical details to users
5. **Handle specific error codes** when custom logic is needed
6. **Test error scenarios** including network failures and edge cases

## Testing

See `utils/__tests__/normalizeError.test.ts` for comprehensive test coverage including:
- Azure DevOps error parsing
- Project name extraction
- TF code stripping
- HTTP status code mapping
- Network error detection
- Unknown error fallback

## Acceptance Criteria

✅ Errors are normalized into `NormalizedError` with correct `code`, `title`, `message`  
✅ Azure DevOps "project already exists" shows the specific name in the UI one-liner  
✅ Axios + Fetch both surface normalized errors to UI  
✅ `ErrorBanner` renders one-line message and appropriate action buttons  
✅ Unit tests pass for all mapped scenarios  
✅ Telemetry logs include `code`, `httpStatus`, and `details` (without leaking PII)  
✅ No technical jargon appears in user-facing text (no TF codes, stack traces, etc.)

