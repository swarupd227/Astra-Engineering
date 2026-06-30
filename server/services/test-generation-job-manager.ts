/**
 * Test Generation Job Manager
 * Handles async job queue for long-running test case generation with polling support
 */

import { randomUUID } from "crypto";

export interface TestGenerationJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  userStory: any;
  testCaseTypes?: any;
  projectId: string;
}

// In-memory job store (can be replaced with Redis/DB for production)
const jobs = new Map<string, TestGenerationJob>();

// Auto-cleanup: Remove completed jobs after 30 minutes
const JOB_RETENTION_MS = 30 * 60 * 1000;

export class TestGenerationJobManager {
  /**
   * Create a new job
   */
  createJob(userStory: any, testCaseTypes: any, projectId: string): string {
    const jobId = randomUUID();
    
    const job: TestGenerationJob = {
      id: jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      userStory,
      testCaseTypes,
      projectId,
    };
    
    jobs.set(jobId, job);
    
    // Schedule auto-cleanup
    setTimeout(() => {
      if (jobs.has(jobId)) {
        const job = jobs.get(jobId);
        if (job && (job.status === 'completed' || job.status === 'failed')) {
          jobs.delete(jobId);
        }
      }
    }, JOB_RETENTION_MS);
    
    return jobId;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): TestGenerationJob | null {
    return jobs.get(jobId) || null;
  }

  /**
   * Update job progress
   */
  updateProgress(jobId: string, progress: number, status?: 'processing' | 'completed' | 'failed') {
    const job = jobs.get(jobId);
    if (!job) return;

    job.progress = Math.min(100, Math.max(0, progress));
    job.updatedAt = new Date();
    
    if (status) {
      job.status = status;
      if (status === 'completed' || status === 'failed') {
        job.completedAt = new Date();
      }
    }
    
    jobs.set(jobId, job);
  }

  /**
   * Mark job as processing
   */
  markAsProcessing(jobId: string) {
    const job = jobs.get(jobId);
    if (!job) return;
    
    job.status = 'processing';
    job.progress = 10;
    job.updatedAt = new Date();
    jobs.set(jobId, job);
  }

  /**
   * Mark job as completed with result
   */
  completeJob(jobId: string, result: any) {
    const job = jobs.get(jobId);
    if (!job) return;
    
    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.updatedAt = new Date();
    job.completedAt = new Date();
    jobs.set(jobId, job);
  }

  /**
   * Mark job as failed with error
   */
  failJob(jobId: string, error: string) {
    const job = jobs.get(jobId);
    if (!job) return;
    
    job.status = 'failed';
    job.error = error;
    job.updatedAt = new Date();
    job.completedAt = new Date();
    jobs.set(jobId, job);
  }

  /**
   * Process a job (runs in background)
   */
  async processJob(jobId: string) {
    const job = jobs.get(jobId);
    if (!job) {
      console.error(`[JobManager] Job ${jobId} not found`);
      return;
    }

    try {
      this.markAsProcessing(jobId);
      
      this.updateProgress(jobId, 20);

      const { default: ManualTestCaseGenerator } = await import("./manual-test-case-generator");

      // Use unified generator approach - single call with all selected test types
      const unifiedGenerator = new ManualTestCaseGenerator();
      const allSelectedTypes = {
        functional: job.testCaseTypes?.functional ?? true,
        negative: job.testCaseTypes?.negative ?? true,
        edgeCases: job.testCaseTypes?.edgeCases ?? true,
        accessibility: job.testCaseTypes?.accessibility ?? true,
        performance: job.testCaseTypes?.performance ?? false,
        security: job.testCaseTypes?.security ?? false,
        usability: job.testCaseTypes?.usability ?? false,
        reliability: job.testCaseTypes?.reliability ?? false,
      };

      const unifiedResults = await unifiedGenerator.generateTestCasesForStories([job.userStory], allSelectedTypes);

      this.updateProgress(jobId, 70);

      if (!unifiedResults || unifiedResults.length === 0) {
        throw new Error("Unified test case generation failed");
      }

      const result = unifiedResults[0]; // Use the unified result directly

      this.updateProgress(jobId, 80);
      
      const selectedCategories = job.testCaseTypes || { 
        functional: true, 
        negative: true, 
        edgeCases: true, 
        accessibility: true,
        performance: false,
        security: false,
        usability: false,
        reliability: false
      };
      
      const functionalTests = Array.isArray(result.functional) ? result.functional : [];
      const negativeTests = Array.isArray(result.negative) ? result.negative : [];
      const edgeCasesTests = Array.isArray(result.edgeCases) ? result.edgeCases : [];
      const accessibilityTests = Array.isArray(result.accessibility) ? result.accessibility : [];
      
      const performanceTests = Array.isArray(result.performance) ? result.performance : [];
      const securityTests = Array.isArray(result.security) ? result.security : [];
      const usabilityTests = Array.isArray(result.usability) ? result.usability : [];
      const reliabilityTests = Array.isArray(result.reliability) ? result.reliability : [];
      
      const missingCoreCategories = [];
      const missingExtendedCategories = [];
      
      if (selectedCategories.functional && functionalTests.length === 0) missingCoreCategories.push("functional");
      if (selectedCategories.negative && negativeTests.length === 0) missingCoreCategories.push("negative");
      if (selectedCategories.edgeCases && edgeCasesTests.length === 0) missingCoreCategories.push("edgeCases");
      if (selectedCategories.accessibility && accessibilityTests.length === 0) missingCoreCategories.push("accessibility");
      
      if (selectedCategories.performance && performanceTests.length === 0) missingExtendedCategories.push("performance");
      if (selectedCategories.security && securityTests.length === 0) missingExtendedCategories.push("security");
      if (selectedCategories.usability && usabilityTests.length === 0) missingExtendedCategories.push("usability");
      if (selectedCategories.reliability && reliabilityTests.length === 0) missingExtendedCategories.push("reliability");
      
      if (missingCoreCategories.length > 0) {
        console.error(`[JobManager] Missing CORE categories:`, missingCoreCategories);
        throw new Error(
          `Core test case generation incomplete. Missing: ${missingCoreCategories.join(", ")}`
        );
      }
      
      if (missingExtendedCategories.length > 0) {
        console.warn(`[JobManager] Missing extended types:`, missingExtendedCategories.join(", "));
        missingExtendedCategories.forEach(cat => {
          if (result[cat]) delete result[cat];
        });
      }
      
      // Complete job with proper structure
      const finalResult = {
        success: true,
        testCases: result,
      };
      
      this.updateProgress(jobId, 100, 'completed');
      this.completeJob(jobId, finalResult);
    } catch (error: any) {
      console.error(`[JobManager] Job ${jobId} failed:`, error.message);
      
      // Provide user-friendly error message
      let userMessage = error.message || "Unknown error";
      if (error.message?.includes("JSON parsing failed")) {
        userMessage = "Failed to generate manual test cases: JSON parsing failed: The AI did not return valid JSON. Possible causes:\n" +
                     "1. AI added markdown blocks or explanations (check terminal)\n" +
                     "2. Response was truncated during generation\n" +
                     "3. JSON structure is malformed\n\n" +
                     "Check the server terminal for the full AI response.";
      }
      
      this.failJob(jobId, userMessage);
    }
  }

  /**
   * Get all active jobs
   */
  getAllJobs(): TestGenerationJob[] {
    return Array.from(jobs.values());
  }

  /**
   * Clean up old completed/failed jobs
   */
  cleanup(maxAgeMs: number = JOB_RETENTION_MS) {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [jobId, job] of jobs.entries()) {
      if (job.completedAt) {
        const age = now - job.completedAt.getTime();
        if (age > maxAgeMs) {
          toDelete.push(jobId);
        }
      }
    }
    
    toDelete.forEach(jobId => jobs.delete(jobId));
    
    if (toDelete.length > 0) {
      console.log(`[JobManager] Cleaned up ${toDelete.length} old jobs`);
    }
  }
}

// Singleton instance
export const jobManager = new TestGenerationJobManager();

// Auto-cleanup every 10 minutes
setInterval(() => {
  jobManager.cleanup();
}, 10 * 60 * 1000);
