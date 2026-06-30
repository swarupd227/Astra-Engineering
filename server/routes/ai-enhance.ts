import type { Express, Request, Response } from "express";
import { ai } from "../ai-client";
import { withAiContext } from "../observability/ai-context";
import { resolveEnhancePrompt } from "../prompts/ai-enhance";
import {
  fetchGuidelineForLocation,
  buildUserPrompt,
  cleanEnhancedText,
} from "../services/ai-enhance-service";
import { randomUUID } from "crypto";

// AI Enhancement Job Management
interface AiEnhanceJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  step: string;
  createdAt: Date;
  completedAt?: Date;
  result?: {
    enhancedText: string;
    usedGuidelines: boolean;
    locationKey: string | null;
  };
  error?: string;
}

const aiEnhanceJobs = new Map<string, AiEnhanceJob>();

// Cleanup old completed/failed AI enhance jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of aiEnhanceJobs.entries()) {
    if ((job.status === 'completed' || job.status === 'failed') &&
      job.completedAt &&
      job.completedAt.getTime() < oneHourAgo) {
      aiEnhanceJobs.delete(jobId);
    }
  }
}, 15 * 60 * 1000); // Run cleanup every 15 minutes

export function registerAiEnhanceRoutes(app: Express): void {
  app.post("/api/ai/enhance", async (req: Request, res: Response) => {
    try {
      const { text, extraPrompt, locationKey, useGuidelines } = req.body as {
        text?: string;
        extraPrompt?: string;
        locationKey?: string;
        useGuidelines?: boolean;
      };

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      const jobId = randomUUID();
      const job: AiEnhanceJob = {
        jobId,
        status: "pending",
        progress: 0,
        step: "Queued",
        createdAt: new Date(),
      };
      aiEnhanceJobs.set(jobId, job);

      res.json({
        success: true,
        jobId,
        status: job.status,
        message: "AI enhancement started. Use /api/ai/enhance/status/:jobId to poll for results.",
      });

      // Background processing
      (async () => {
        try {
          job.status = "processing";
          job.step = "Preparing enhancement...";
          job.progress = 10;

          // 1. Resolve system prompt from locationKey
          const systemPrompt = resolveEnhancePrompt(locationKey);

          job.step = "Loading guidelines...";
          job.progress = 25;

          // 2. Optionally fetch golden repo guidelines
          let guidelineText: string | null = null;
          const shouldUseGuidelines = useGuidelines !== false;
          if (shouldUseGuidelines && locationKey && typeof locationKey === "string") {
            try {
              guidelineText = await fetchGuidelineForLocation(locationKey);
            } catch (e) {
              console.error("[AI Enhance] Error loading guideline content:", e);
            }
          }

          job.step = "Calling AI for enhancement...";
          job.progress = 50;

          // 3. Build user prompt with guidelines and extra instructions
          const userPrompt = buildUserPrompt(text, guidelineText, extraPrompt);

          // 4. Call AI via centralized client
          const modelName = process.env.AZURE_OPENAI_API_KEY
            ? (process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini")
            : "gpt-4o-mini";

          const deployment = (modelName || "").toLowerCase();
          const isNewModel =
            deployment.includes("gpt-5") ||
            deployment.includes("o1") ||
            deployment.includes("o3");

          const requestBody: Record<string, any> = {
            model: modelName,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          };

          if (isNewModel) {
            requestBody.max_completion_tokens = 2000;
            requestBody.temperature = 1;
          } else {
            requestBody.max_tokens = 2000;
            requestBody.temperature = 0.7;
          }

          const completion = await withAiContext(
            { feature: "ai_enhance", useCase: "ai enhance" },
            () => ai.chat.completions.create(requestBody),
          );

          job.step = "Processing AI response...";
          job.progress = 90;

          // 5. Clean and return — skip markdown stripping for BRD sections (they need tables/headers)
          const rawText = completion.choices[0]?.message?.content?.trim() || text;
          const isBrdSection = locationKey === "brd.section";
          const enhancedText = isBrdSection ? rawText : cleanEnhancedText(rawText);

          job.status = "completed";
          job.step = "Completed";
          job.progress = 100;
          job.completedAt = new Date();
          job.result = {
            enhancedText,
            usedGuidelines: !!guidelineText,
            locationKey: locationKey || null,
          };
        } catch (error: any) {
          console.error("[AI Enhance] Error while enhancing text:", error);
          const errorMessage = error?.message || String(error);
          const isContentFilter =
            error?.code === "content_filter" ||
            errorMessage.includes("content management policy") ||
            errorMessage.includes("content_filter") ||
            error?.error?.code === "content_filter";

          if (isContentFilter) {
            console.warn(
              "[AI Enhance] Content filter triggered — locationKey: %s, textLength: %d, hasGuidelines: %s",
              locationKey ?? "none",
              text?.length ?? 0,
              !!useGuidelines,
            );
            job.error = "The text could not be enhanced because it was flagged by the content safety filter. Try simplifying or shortening the input text.";
          } else {
            job.error = errorMessage;
          }

          job.status = "failed";
          job.step = "Failed";
          job.completedAt = new Date();
        }
      })();
    } catch (error: any) {
      console.error("[AI Enhance] Failed to start enhancement job:", error);
      res.status(500).json({
        error: "Failed to start AI enhancement job",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Poll AI enhancement job status
  app.get("/api/ai/enhance/status/:jobId", async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = aiEnhanceJobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        error: "AI enhancement job not found",
        jobId,
      });
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      step: job.step,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  });
}
