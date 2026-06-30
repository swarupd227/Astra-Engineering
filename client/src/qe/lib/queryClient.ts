import { QueryClient, type QueryFunction } from "@tanstack/react-query";

const defaultQueryFn: QueryFunction = async ({ queryKey }) => {
  const url = queryKey.join("/") as string;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export async function apiRequest(
  methodOrUrl: string,
  urlOrOptions?: string | RequestInit,
  data?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let url: string;
  let options: RequestInit;

  if (typeof urlOrOptions === "string") {
    url = urlOrOptions;
    const isFormData = typeof FormData !== "undefined" && data instanceof FormData;
    options = {
      method: methodOrUrl,
      headers: data && !isFormData ? { "Content-Type": "application/json" } : {},
      body: data ? (isFormData ? (data as FormData) : JSON.stringify(data)) : undefined,
      credentials: "include",
      signal,
    };
  } else {
    url = methodOrUrl;
    options = {
      ...urlOrOptions,
      headers: {
        "Content-Type": "application/json",
        ...(urlOrOptions?.headers as Record<string, string>),
      },
    };
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res;
}

export async function devxFetch(url: string, options?: RequestInit): Promise<Response> {
  const originalFetch = (window as any).__devxOriginalFetch || window.fetch;
  return originalFetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}
