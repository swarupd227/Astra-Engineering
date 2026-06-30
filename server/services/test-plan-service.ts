import { randomUUID } from "crypto";
import { testPlanSectionBatches } from "../constants/testing-constants";
import { prompt_test_plan_generation } from "../prompts/prompt_test_plan_generation";
import { azureOpenAI, anthropic, hasAzureOpenAI, hasAnthropic, hasBedrock, llmConfig } from "../llm-config";
import { NEW_API_MODEL_SUBSTRINGS } from "../llm-config-constants";
import { injectToc } from "../lib/markdown-utils";
import { trackEventSuccessOnly } from "../metrics-helper";
import { TEST_PLAN_TOKEN_COST } from "./token-service";

export interface TestPlanGenerationJob {
  jobId: string;
  status: "processing" | "completed" | "failed";
  step: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  progress?: {
    percent: number;
    stepKey: string;
    message: string;
    updatedAt: Date;
  };
  result?: {
    testPlan: string;
  };
}

class TestPlanService {
  private jobs = new Map<string, TestPlanGenerationJob>();

  createJob(jobId: string): TestPlanGenerationJob {
    const job: TestPlanGenerationJob = {
      jobId,
      status: "processing",
      step: "Queued",
      createdAt: new Date(),
      progress: {
        percent: 0,
        stepKey: "queued",
        message: "Test plan generation queued",
        updatedAt: new Date(),
      },
    };
    this.jobs.set(jobId, job);
    return job;
  }

  getJob(jobId: string): TestPlanGenerationJob | undefined {
    return this.jobs.get(jobId);
  }

  updateJobProgress(jobId: string, progress: { percent: number; stepKey: string; message: string }) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    job.progress = {
      percent,
      stepKey: progress.stepKey,
      message: progress.message,
      updatedAt: new Date(),
    };
    job.step = progress.message;
  }

  markJobCompleted(jobId: string, testPlan: string, startTime: number) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "completed";
    job.step = "Completed";
    job.completedAt = new Date();
    job.result = { testPlan };
    job.progress = {
      percent: 100,
      stepKey: "completed",
      message: "Test plan generation completed",
      updatedAt: new Date(),
    };
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Test Plan Service] Job ${jobId} completed in ${elapsed}s (${testPlan.length} chars).`);
  }

  markJobFailed(jobId: string, error: unknown) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const message = error instanceof Error ? error.message : String(error);
    job.status = "failed";
    job.step = "Failed";
    job.error = message;
    job.completedAt = new Date();
    console.error(`[Test Plan Service] Job ${jobId} failed:`, message);
  }

  async startGeneration(jobId: string, brdContent: string, userId: string | undefined, projectId: string) {
    const startTime = Date.now();
    try {
      const deployment = llmConfig.azureOpenAIDeployment!;
      const d = deployment.toLowerCase();
      const isNewModel = NEW_API_MODEL_SUBSTRINGS.some((m) => d.includes(m));

      this.updateJobProgress(jobId, {
        percent: 10,
        stepKey: "generation_started",
        message: "Generating test plan sections...",
      });

      console.log(`[Test Plan Service] Job ${jobId}: launching parallel generation for ${testPlanSectionBatches.length} batches...`);

      const batchPromises = testPlanSectionBatches.map(async (batch, index) => {
        const batchNum = index + 1;
        let batchContent = "";
        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount < maxRetries && (!batchContent || batchContent.trim().length < 200)) {
          try {
            const batchPrompt = `${prompt_test_plan_generation}\n\n
### IMPORTANT: TASK-SPECIFIC INSTRUCTION ###
You are currently generating ONLY ${batch.name} (specifically Sections ${batch.sections}).
${batch.instructions}

**OUTPUT CONSTRAINTS:**
1. Do NOT include any introductory or concluding conversational text.
2. Return ONLY the markdown content for sections ${batch.sections}.
3. Use the exact headers defined in the main prompt.
4. Do NOT repeat headers from other sections outside this batch.
5. **MANDATORY**: Use professional Markdown tables for all structured data, including test environments, schedules, risk matrices, metrics, and approval sign-offs. 
6. **FORMATTING**: Ensure all tables have a blank line (double newline) before and after the table to ensure correct rendering. Each table row must be on its own line.

**BRD Content Reference:**
${brdContent}`;

            if ((hasAzureOpenAI || hasBedrock) && azureOpenAI) {
              const payload: any = {
                model: deployment,
                messages: [
                  {
                    role: "system",
                    content: "You are an expert QA/Test Lead. Return ONLY the requested markdown sections with NO conversational filler. Be extremely detailed and exhaustive."
                  },
                  { role: "user", content: batchPrompt }
                ]
              };
              if (isNewModel) {
                payload.max_completion_tokens = 16000;
                payload.temperature = 0.7;
              } else {
                payload.max_tokens = 16000;
                payload.temperature = 0.7;
              }
              const llmRes = await azureOpenAI.chat.completions.create(payload);
              batchContent = llmRes.choices[0]?.message?.content || "";
            } else if (hasAnthropic && anthropic) {
              const llmRes = await anthropic.messages.create({
                model: llmConfig.anthropicModel,
                max_tokens: 8192,
                messages: [{ role: "user", content: batchPrompt }],
                system: "You are an expert QA/Test Lead. Return ONLY the requested markdown sections with NO conversational filler. Be extremely detailed and exhaustive."
              });
              batchContent = (llmRes.content[0] as any).text || "";
            }
          } catch (error) {
            console.error(`[Test Plan Service] Job ${jobId}: error in batch ${batchNum} (attempt ${retryCount + 1}):`, error);
          }
          retryCount++;
          if (!batchContent || batchContent.trim().length < 200) {
            console.log(`[Test Plan Service] Job ${jobId}: batch ${batchNum} content too short or failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        console.log(`[Test Plan Service] Job ${jobId}: batch ${batchNum} finished with ${batchContent?.length || 0} characters.`);
        return batchContent;
      });

      const sectionResults = await Promise.all(batchPromises);
      let testPlan = sectionResults.filter(Boolean).join("\n\n");

      // Fallback
      if (!testPlan || testPlan.trim().length < 2000) {
        console.log(`[Test Plan Service] Job ${jobId}: batch generation insufficient, falling back to single prompt`);
        const fullPrompt = `${prompt_test_plan_generation}\n\n**BRD Content:**\n${brdContent}`;

        if ((hasAzureOpenAI || hasBedrock) && azureOpenAI) {
          const payload: any = {
            model: deployment,
            messages: [
              {
                role: "system",
                content: "You are an expert QA/Test Lead creating comprehensive test plans. Generate detailed, production-ready test plans."
              },
              { role: "user", content: fullPrompt }
            ]
          };
          if (isNewModel) {
            payload.max_completion_tokens = 16000;
            payload.temperature = 0.7;
          } else {
            payload.max_tokens = 16000;
            payload.temperature = 0.7;
          }
          const llmRes = await azureOpenAI.chat.completions.create(payload);
          testPlan = llmRes.choices[0]?.message?.content || "";
        } else if (hasAnthropic && anthropic) {
          const llmRes = await anthropic.messages.create({
            model: llmConfig.anthropicModel,
            max_tokens: 8192,
            messages: [{ role: "user", content: fullPrompt }],
            system: "You are an expert QA/Test Lead creating comprehensive test plans."
          });
          testPlan = (llmRes.content[0] as any).text || "";
        }
      }

      if (!testPlan || testPlan.trim().length < 50) {
        throw new Error("Failed to generate test plan content.");
      }

      const testPlanWithToc = injectToc(testPlan);
      this.markJobCompleted(jobId, testPlanWithToc, startTime);

      // Metrics
      try {
        await trackEventSuccessOnly({
          artifactId: randomUUID(),
          useCase: "Test Plan Generation",
          tokensUsed: TEST_PLAN_TOKEN_COST,
          processingTimeMs: Date.now() - startTime,
          userId,
          projectId,
        });
      } catch (metricError) {
        console.error(`[Test Plan Service] Job ${jobId}: failed to track metrics:`, metricError);
      }

    } catch (err) {
      this.markJobFailed(jobId, err);
    }
  }
}

export const testPlanService = new TestPlanService();
