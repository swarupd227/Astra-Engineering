import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getApiUrl } from "./api-config";
import { normalizeError } from "@/utils/normalizeError";
import { addAuthToRequest, isAuthSessionExpired } from "@/lib/auth-request";
import { toast } from "@/hooks/use-toast";
import { setCredentialReconnectNeeded } from "@/components/jira-reconnect-banner";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorData: unknown;
    const contentType = res.headers.get("content-type");
    
    try {
      if (contentType?.includes("application/json")) {
        errorData = await res.json();
      } else {
        const text = await res.text();
        errorData = text || res.statusText;
      }
    } catch {
      errorData = res.statusText || `HTTP ${res.status}`;
    }

    // Create error object with response info for normalization
    // Include the raw errorData directly so Azure DevOps errors can be parsed
    const error: any = {
      response: {
        status: res.status,
        statusText: res.statusText,
        data: errorData,
      },
      // Also include errorData at top level for Azure DevOps error parsing
      ...(typeof errorData === "object" && errorData !== null ? errorData : {}),
      message: typeof errorData === "string" ? errorData : JSON.stringify(errorData),
    };

    // Detect JIRA / GitLab PAT errors and trigger the reconnect banner.
    const errorCode = typeof errorData === "object" && errorData !== null ? (errorData as any).code : undefined;
    if (errorCode === "JIRA_PAT_MISSING" || errorCode === "JIRA_PAT_INVALID") {
      setCredentialReconnectNeeded("jira", true);
    } else if (errorCode === "GITLAB_PAT_MISSING" || errorCode === "GITLAB_PAT_INVALID") {
      setCredentialReconnectNeeded("gitlab", true);
    } else if (res.status === 428) {
      // 428 Precondition Required is our generic "credential missing" signal.
      const provider = typeof errorData === "object" && errorData !== null ? (errorData as any).provider : undefined;
      setCredentialReconnectNeeded(provider === "gitlab" ? "gitlab" : "jira", true);
    }

    // Onboarding gate: the route guard handles redirecting to Profile Setup,
    // so don't show a misleading "no permission" toast for this 403.
    if (res.status === 403 && errorCode === "ONBOARDING_REQUIRED") {
      const normalized = normalizeError(error);
      throw normalized;
    }

    if (res.status === 403) {
      error.code = "PERMISSION_DENIED";
      if (!error.message || error.message === "{}") {
        error.message =
          (typeof errorData === "object" && errorData && (errorData as any).message) ||
          (typeof errorData === "object" && errorData && (errorData as any).error) ||
          "You don't have permission to perform this action.";
      }
    }

    // Normalize and throw
    const normalized = normalizeError(error);
    throw normalized;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  signal?: AbortSignal | undefined,
): Promise<Response> {
  // Session expired — don't fire any more requests
  if (isAuthSessionExpired()) {
    throw new Error("Session expired");
  }

  const fullUrl = getApiUrl(url);

  // Build base options — skip Content-Type and JSON serialization for FormData
  const isFormData = typeof FormData !== "undefined" && data instanceof FormData;
  const baseOptions: RequestInit = {
    method,
    headers: data && !isFormData ? { "Content-Type": "application/json" } : {},
    body: data ? (isFormData ? data as FormData : JSON.stringify(data)) : undefined,
    credentials: "include",
    signal,
  };

  // Add user info from MSAL to headers
  const optionsWithUserInfo = await addAuthToRequest(fullUrl, baseOptions);

  const res = await fetch(fullUrl, optionsWithUserInfo);
  console.log("[apiRequest] Response status:", res.status, res.statusText);

  if (res.status === 403) {
    let isOnboarding = false;
    try {
      const clone = res.clone();
      const data = await clone.json();
      if (data?.code === "ONBOARDING_REQUIRED") isOnboarding = true;
    } catch (e) {}

    if (!isOnboarding) {
      toast.error("You don't have permission to perform this action.");
    }
  }

  await throwIfResNotOk(res);
  return res;
}

const defaultQueryFn: QueryFunction = async ({ queryKey }) => {
  // Session expired — return null silently instead of throwing,
  // which prevents error → re-render → refetch loops.
  if (isAuthSessionExpired()) {
    return null;
  }

  const url = queryKey.join("/") as string;
  const fullUrl = getApiUrl(url);

  const baseOptions: RequestInit = {
    credentials: "include",
  };
  const optionsWithUserInfo = await addAuthToRequest(fullUrl, baseOptions);

  const res = await fetch(fullUrl, optionsWithUserInfo);

  // 401 is handled by the fetch interceptor (redirect to login).
  // Return null here to avoid throwing, which would cause
  // error → re-render → refetch loops.
  if (res.status === 401) {
    return null;
  }

  await throwIfResNotOk(res);
  return await res.json();
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
