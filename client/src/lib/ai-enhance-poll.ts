import { apiRequest } from "./queryClient";

export type AiEnhancePollSuccess = {
  success: true;
  enhancedText: string;
  usedGuidelines: boolean;
  locationKey: string | null;
};

export type AiEnhancePollFailure = {
  success: false;
  error: string;
};

export type AiEnhancePollResult = AiEnhancePollSuccess | AiEnhancePollFailure;

type StatusPayload = {
  status: string;
  result?: {
    enhancedText: string;
    usedGuidelines: boolean;
    locationKey: string | null;
  };
  error?: string;
};

/**
 * Polls GET /api/ai/enhance/status/:jobId until the async enhancement job completes or fails.
 */
export async function waitForAiEnhanceJob(
  jobId: string,
  options?: { pollIntervalMs?: number; timeoutMs?: number },
): Promise<AiEnhancePollResult> {
  const pollIntervalMs = options?.pollIntervalMs ?? 750;
  const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await apiRequest(
      "GET",
      `/api/ai/enhance/status/${encodeURIComponent(jobId)}`,
    );
    const data = (await res.json()) as StatusPayload;

    if (data.status === "completed" && data.result?.enhancedText != null) {
      return {
        success: true,
        enhancedText: data.result.enhancedText,
        usedGuidelines: data.result.usedGuidelines,
        locationKey: data.result.locationKey,
      };
    }
    if (data.status === "failed") {
      return {
        success: false,
        error: data.error || "Enhancement failed",
      };
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return {
    success: false,
    error: "Enhancement timed out. Please try again.",
  };
}
