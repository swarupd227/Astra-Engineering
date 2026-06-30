/**
 * BDD Generation Job Manager
 * Handles async job queue for BDD asset generation with polling support
 */

import { randomUUID } from "crypto";

export interface BDDGenerationJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  testCases: any;
  userStory: any;
  testFramework: string;
}

// In-memory job store
const jobs = new Map<string, BDDGenerationJob>();

// Auto-cleanup: Remove completed jobs after 30 minutes
const JOB_RETENTION_MS = 30 * 60 * 1000;

export class BDDGenerationJobManager {
  /**
   * Create a new BDD generation job
   */
  createJob(testCases: any, userStory: any, testFramework: string): string {
    const jobId = randomUUID();
    
    const job: BDDGenerationJob = {
      id: jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      testCases,
      userStory,
      testFramework,
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
  getJob(jobId: string): BDDGenerationJob | null {
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
   * Process BDD generation job (runs in background)
   * PHASE 1: Generate feature files in parallel using LLM (4 parallel calls)
   * PHASE 2: Generate step definitions in parallel using LLM (4 parallel calls)
   */
  async processJob(jobId: string) {
    const job = jobs.get(jobId);
    if (!job) {
      console.error(`[BDDJobManager] Job ${jobId} not found`);
      return;
    }

    try {
      this.markAsProcessing(jobId);
      const startTime = Date.now();
      
      const { FeatureFileGenerator } = await import("./feature-file-generator");
      const { StepDefinitionGenerator } = await import("./step-definition-generator");
      
      this.updateProgress(jobId, 10);
      
      const featureGenerator = new FeatureFileGenerator();
      const featureFiles = await featureGenerator.generateFeatureFiles(job.testCases, job.userStory);
      
      this.updateProgress(jobId, 50);
      
      let normalizedFramework: 'playwright' | 'selenium' = 'playwright';
      if (job.testFramework) {
        const frameworkLower = job.testFramework.toLowerCase();
        if (frameworkLower.includes('selenium')) {
          normalizedFramework = 'selenium';
        } else if (frameworkLower.includes('playwright')) {
          normalizedFramework = 'playwright';
        }
      }
      
      const stepDefGenerator = new StepDefinitionGenerator(normalizedFramework);
      const stepDefFiles = await stepDefGenerator.generateStepDefinitions(featureFiles, job.userStory);
      
      // Update progress: Both phases complete
      this.updateProgress(jobId, 100, 'completed');
      
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      const result = {
        success: true,
        featureFiles,
        stepDefFiles,
        summary: {
          totalFeatureFiles: featureFiles.length,
          totalStepDefFiles: stepDefFiles.length,
          framework: normalizedFramework,
          generationTimeSeconds: parseFloat(totalDuration),
          llmProvider: process.env.ANTHROPIC_AZURE_ENDPOINT ? 'Anthropic Claude' : 'Azure OpenAI'
        }
      };
      
      this.completeJob(jobId, result);
    } catch (error: any) {
      console.error(`[BDDJobManager] Job ${jobId} failed:`, error.message);
      this.failJob(jobId, error.message || "Unknown error");
    }
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
  }
}

// Singleton instance
export const bddJobManager = new BDDGenerationJobManager();

// Auto-cleanup every 10 minutes
setInterval(() => {
  bddJobManager.cleanup();
}, 10 * 60 * 1000);
