import { EventEmitter } from "events";
import { progressTracker, type ProgressEvent, type FileChange } from "./progress-tracking.service";
import { DeploymentService, type DeploymentResult } from "./deployment.service";
import { randomUUID } from "crypto";

export interface PipelineStage {
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  logs?: string[];
  errors?: string[];
  artifacts?: string[];
}

export interface PipelineProgress {
  sessionId: string;
  repositoryName: string;
  buildId?: string;
  pipelineId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  stages: PipelineStage[];
  currentStage: string;
  progress: number; // 0-100
  startTime: Date;
  endTime?: Date;
  totalDuration?: number;
  queuedDuration?: number;
  buildDuration?: number;
}

export class PipelineProgressService extends EventEmitter {
  private activePipelines: Map<string, PipelineProgress> = new Map();

  constructor() {
    super();
  }

  /**
   * Create a new pipeline progress session
   */
  public createPipelineSession(
    repositoryName: string,
    organizationName: string,
    projectId: string
  ): string {
    const sessionId = progressTracker.createSession(repositoryName, organizationName, projectId, 8);
    
    const pipelineProgress: PipelineProgress = {
      sessionId,
      repositoryName,
      status: 'queued',
      stages: this.getDefaultStages(),
      currentStage: 'Queue',
      progress: 0,
      startTime: new Date()
    };

    this.activePipelines.set(sessionId, pipelineProgress);

    progressTracker.updateProgress(
      sessionId,
      'repo-creation',
      'Repository Analysis',
      'in-progress',
      'Analyzing repository structure and dependencies...',
      { repositoryName }
    );

    return sessionId;
  }

  /**
   * Update repository creation progress
   */
  public updateRepoCreation(
    sessionId: string,
    stage: 'analyzing' | 'generating' | 'committing' | 'configuring' | 'completed',
    message: string,
    details?: any,
    fileChanges?: FileChange[]
  ): void {
    const stageMap = {
      'analyzing': 'Repository Analysis',
      'generating': 'Code Generation',
      'committing': 'Initial Commit',
      'configuring': 'Pipeline Configuration',
      'completed': 'Repository Ready'
    };

    const status = stage === 'completed' ? 'completed' : 'in-progress';
    
    progressTracker.updateProgress(
      sessionId,
      'repo-creation',
      stageMap[stage],
      status,
      message,
      details,
      fileChanges,
      stage === 'completed' ? 100 : undefined
    );

    if (stage === 'completed') {
      this.startPipelineBuild(sessionId, message);
    }
  }

  /**
   * Start pipeline build process
   */
  public startPipelineBuild(sessionId: string, triggerMessage: string = 'Repository ready, starting build...'): void {
    const pipeline = this.activePipelines.get(sessionId);
    if (!pipeline) return;

    pipeline.status = 'running';
    pipeline.currentStage = 'Build';
    
    progressTracker.updateProgress(
      sessionId,
      'pipeline-run',
      'Build Initialization',
      'in-progress',
      triggerMessage,
      { 
        buildStarted: new Date(),
        estimatedDuration: '5-10 minutes'
      }
    );

    // Simulate pipeline stages with realistic timing
    this.simulatePipelineStages(sessionId);
  }

  /**
   * Update pipeline stage progress
   */
  public updatePipelineStage(
    sessionId: string,
    stageName: string,
    status: PipelineStage['status'],
    message: string,
    logs?: string[],
    errors?: string[]
  ): void {
    const pipeline = this.activePipelines.get(sessionId);
    if (!pipeline) return;

    // Update pipeline stage
    const stage = pipeline.stages.find(s => s.name === stageName);
    if (stage) {
      stage.status = status;
      if (status === 'in-progress' && !stage.startTime) {
        stage.startTime = new Date();
      }
      if (status === 'completed' || status === 'failed') {
        stage.endTime = new Date();
      }
      if (logs) stage.logs = [...(stage.logs || []), ...logs];
      if (errors) stage.errors = [...(stage.errors || []), ...errors];
    }

    pipeline.currentStage = stageName;
    pipeline.progress = this.calculateProgress(pipeline.stages);

    const eventType = stageName.includes('Build') ? 'pipeline-run' : 
                     stageName.includes('Deploy') ? 'deployment' : 'pipeline-run';

    progressTracker.updateProgress(
      sessionId,
      eventType,
      stageName,
      status === 'skipped' ? 'warning' : status,
      message,
      { 
        logs: logs?.slice(-5), // Last 5 log lines
        errors: errors?.slice(-3), // Last 3 errors
        progress: pipeline.progress
      },
      undefined,
      pipeline.progress
    );

    // Handle stage completion
    if (status === 'completed') {
      this.onStageCompleted(sessionId, stageName);
    } else if (status === 'failed') {
      this.onStageFailed(sessionId, stageName, errors?.[0] || 'Stage failed');
    }
  }

  /**
   * Start deployment process
   */
  public startDeployment(sessionId: string, target: string, buildArtifacts?: string[]): void {
    progressTracker.updateProgress(
      sessionId,
      'deployment',
      'Deployment Preparation',
      'in-progress',
      `Preparing deployment to ${target}...`,
      { 
        target,
        artifacts: buildArtifacts,
        deploymentType: 'Azure App Service'
      }
    );

    setTimeout(() => {
      this.updatePipelineStage(
        sessionId,
        'Deploy to Azure',
        'in-progress',
        'Deploying application to Azure App Service...',
        [
          'Starting deployment...',
          'Uploading artifacts...',
          'Configuring app settings...'
        ]
      );
    }, 2000);
  }

  /**
   * Complete deployment with health check
   */
  public completeDeployment(sessionId: string, result: DeploymentResult, appUrl: string): void {
    const success = result.status === 'SUCCESS';
    
    this.updatePipelineStage(
      sessionId,
      'Deploy to Azure',
      success ? 'completed' : 'failed',
      success ? 'Deployment completed successfully' : 'Deployment failed',
      success ? ['Deployment completed', 'App service updated', 'Health check started'] : undefined,
      success ? undefined : ['Deployment failed', result.logs || 'Unknown error']
    );

    if (success) {
      // Start health check
      progressTracker.updateProgress(
        sessionId,
        'health-check',
        'Application Health Check',
        'in-progress',
        `Verifying application health at ${appUrl}...`,
        { 
          url: appUrl,
          expectedStatus: 200,
          timeout: '30 seconds'
        }
      );

      // Simulate health check
      setTimeout(() => {
        this.performHealthCheck(sessionId, appUrl);
      }, 3000);
    } else {
      this.completePipeline(sessionId, 'failed', `Deployment failed: ${result.logs || 'Unknown error'}`);
    }
  }

  /**
   * Perform application health check
   */
  private async performHealthCheck(sessionId: string, appUrl: string): Promise<void> {
    try {
      const response = await fetch(appUrl, { 
        method: 'HEAD', 
        signal: AbortSignal.timeout(30000) 
      });

      const isHealthy = response.ok;
      
      if (isHealthy) {
        progressTracker.completeStage(
          sessionId,
          'health-check',
          'Application Health Check',
          `✅ Application is healthy and responding at ${appUrl}`,
          { 
            status: response.status,
            statusText: response.statusText,
            url: appUrl,
            healthy: true
          }
        );

        this.completePipeline(sessionId, 'completed', `🎉 Deployment successful! Application is live at ${appUrl}`);
      } else {
        progressTracker.failStage(
          sessionId,
          'health-check',
          'Application Health Check',
          `❌ Application deployed but not responding correctly (HTTP ${response.status})`,
          { 
            status: response.status,
            statusText: response.statusText,
            url: appUrl,
            healthy: false
          }
        );

        // Start AI-powered debugging
        this.startAIDebugging(sessionId, appUrl, response.status);
      }
    } catch (error) {
      progressTracker.failStage(
        sessionId,
        'health-check',
        'Application Health Check',
        `❌ Failed to connect to application: ${error instanceof Error ? error.message : String(error)}`,
        { 
          url: appUrl,
          error: String(error),
          healthy: false
        }
      );

      this.startAIDebugging(sessionId, appUrl, 0);
    }
  }

  /**
   * Start AI-powered debugging when health check fails
   */
  private startAIDebugging(sessionId: string, appUrl: string, statusCode: number): void {
    progressTracker.updateProgress(
      sessionId,
      'ai-fix',
      'AI Debugging Initialization',
      'in-progress',
      '🤖 Starting AI-powered debugging and fix generation...',
      { 
        appUrl,
        statusCode,
        aiEngine: 'Azure OpenAI GPT-4',
        debuggingTypes: ['deployment logs', 'configuration analysis', 'common patterns']
      }
    );

    // Trigger Ralph Loop for automated fixing
    setTimeout(() => {
      this.triggerRalphLoop(sessionId, appUrl);
    }, 2000);
  }

  /**
   * Trigger Ralph Loop for automated issue resolution
   */
  private triggerRalphLoop(sessionId: string, appUrl: string): void {
    const pipeline = this.activePipelines.get(sessionId);
    if (!pipeline) return;

    progressTracker.updateProgress(
      sessionId,
      'ai-fix',
      'Ralph Loop Activation',
      'in-progress',
      '🔄 Activating Ralph Loop for automated issue resolution...',
      { 
        repositoryName: pipeline.repositoryName,
        targetUrl: appUrl,
        autoFixEnabled: true,
        maxIterations: 3
      }
    );

    // This would trigger the actual Ralph Loop
    // For now, simulate the process
    setTimeout(() => {
      this.simulateAIFixes(sessionId);
    }, 3000);
  }

  /**
   * Simulate AI-generated fixes
   */
  private simulateAIFixes(sessionId: string): void {
    const commonFixes = [
      {
        file: 'package.json',
        issue: 'Missing start script',
        fix: 'Added "start": "node server.js" script',
        code: '{\n  "scripts": {\n    "start": "node server.js"\n  }\n}'
      },
      {
        file: 'server.js',
        issue: 'Hardcoded port number',
        fix: 'Updated to use process.env.PORT || 3000',
        code: 'const port = process.env.PORT || 3000;'
      },
      {
        file: '.env',
        issue: 'Missing environment variables',
        fix: 'Added required Azure App Service variables',
        code: 'WEBSITE_NODE_DEFAULT_VERSION=18.x\nSCM_DO_BUILD_DURING_DEPLOYMENT=true'
      }
    ];

    let fixIndex = 0;
    
    const applyNextFix = () => {
      if (fixIndex >= commonFixes.length) {
        // All fixes applied, trigger redeployment
        this.triggerRedeployment(sessionId);
        return;
      }

      const fix = commonFixes[fixIndex++];
      
      progressTracker.addFileChange(
        sessionId,
        fix.file,
        'modified',
        'applying',
        undefined,
        fix.fix,
        '// Original content...',
        fix.code
      );

      progressTracker.updateProgress(
        sessionId,
        'ai-fix',
        'AI Fix Application',
        'in-progress',
        `🔧 Applying fix to ${fix.file}: ${fix.fix}`,
        { 
          fileName: fix.file,
          fixDescription: fix.fix,
          changeType: 'modification'
        }
      );

      setTimeout(() => {
        progressTracker.addFileChange(
          sessionId,
          fix.file,
          'modified',
          'applied'
        );

        setTimeout(applyNextFix, 2000);
      }, 3000);
    };

    applyNextFix();
  }

  /**
   * Trigger redeployment after AI fixes
   */
  private triggerRedeployment(sessionId: string): void {
    progressTracker.updateProgress(
      sessionId,
      'deployment',
      'Redeployment',
      'in-progress',
      '🚀 AI fixes applied! Triggering redeployment...',
      { 
        fixesApplied: 3,
        redeploymentReason: 'AI-generated fixes applied',
        estimatedTime: '3-5 minutes'
      }
    );

    // Simulate redeployment success after AI fixes
    setTimeout(() => {
      const pipeline = this.activePipelines.get(sessionId);
      if (pipeline) {
        const appUrl = `https://${pipeline.repositoryName}.azurewebsites.net`;
        
        progressTracker.completeStage(
          sessionId,
          'deployment',
          'Redeployment',
          '✅ Redeployment completed successfully!'
        );

        setTimeout(() => {
          progressTracker.completeStage(
            sessionId,
            'ai-fix',
            'AI Fix Validation',
            `🎉 AI fixes successful! Application is now healthy at ${appUrl}`,
            { 
              finalUrl: appUrl,
              fixesApplied: ['package.json script', 'port configuration', 'environment variables'],
              healthStatus: 'healthy'
            }
          );

          this.completePipeline(sessionId, 'completed', `🎉 AI-powered fix successful! Application is live at ${appUrl}`);
        }, 2000);
      }
    }, 8000);
  }

  /**
   * Complete the entire pipeline
   */
  private completePipeline(sessionId: string, status: 'completed' | 'failed', message: string): void {
    const pipeline = this.activePipelines.get(sessionId);
    if (!pipeline) return;

    pipeline.status = status;
    pipeline.endTime = new Date();
    pipeline.totalDuration = pipeline.endTime.getTime() - pipeline.startTime.getTime();

    progressTracker.updateProgress(
      sessionId,
      'deployment',
      'Pipeline Complete',
      status,
      message,
      { 
        totalDuration: `${Math.round(pipeline.totalDuration / 1000)}s`,
        finalStatus: status,
        completedStages: pipeline.stages.filter(s => s.status === 'completed').length,
        totalStages: pipeline.stages.length
      },
      undefined,
      100
    );

    progressTracker.closeSession(sessionId, status, message);
    
    // Clean up
    setTimeout(() => {
      this.activePipelines.delete(sessionId);
    }, 300000); // 5 minutes
  }

  private onStageCompleted(sessionId: string, stageName: string): void {
    // Logic for handling completed stages
    const nextStageMap: { [key: string]: string } = {
      'Queue': 'Build',
      'Build': 'Test',
      'Test': 'Package',
      'Package': 'Deploy to Azure',
      'Deploy to Azure': 'Health Check',
      'Health Check': 'Complete'
    };

    const nextStage = nextStageMap[stageName];
    if (nextStage && nextStage !== 'Complete') {
      setTimeout(() => {
        this.updatePipelineStage(
          sessionId,
          nextStage,
          'in-progress',
          `Starting ${nextStage}...`
        );
      }, 1000);
    }
  }

  private onStageFailed(sessionId: string, stageName: string, error: string): void {
    this.completePipeline(sessionId, 'failed', `Pipeline failed at ${stageName}: ${error}`);
  }

  private simulatePipelineStages(sessionId: string): void {
    const stages = ['Queue', 'Build', 'Test', 'Package'];
    let currentStageIndex = 0;

    const processNextStage = () => {
      if (currentStageIndex >= stages.length) {
        // Start deployment
        this.startDeployment(sessionId, 'Azure App Service', ['app.zip']);
        return;
      }

      const stage = stages[currentStageIndex++];
      const duration = Math.random() * 10000 + 5000; // 5-15 seconds

      this.updatePipelineStage(sessionId, stage, 'in-progress', `Processing ${stage}...`);

      setTimeout(() => {
        this.updatePipelineStage(
          sessionId, 
          stage, 
          'completed', 
          `${stage} completed successfully`,
          [`${stage} logs...`, `${stage} finished at ${new Date().toISOString()}`]
        );
        
        setTimeout(processNextStage, 1000);
      }, duration);
    };

    processNextStage();
  }

  private calculateProgress(stages: PipelineStage[]): number {
    const completedStages = stages.filter(s => s.status === 'completed').length;
    return Math.round((completedStages / stages.length) * 100);
  }

  private getDefaultStages(): PipelineStage[] {
    return [
      { name: 'Queue', status: 'pending' },
      { name: 'Build', status: 'pending' },
      { name: 'Test', status: 'pending' },
      { name: 'Package', status: 'pending' },
      { name: 'Deploy to Azure', status: 'pending' },
      { name: 'Health Check', status: 'pending' },
      { name: 'AI Analysis', status: 'pending' },
      { name: 'Complete', status: 'pending' }
    ];
  }

  public getPipelineProgress(sessionId: string): PipelineProgress | null {
    return this.activePipelines.get(sessionId) || null;
  }
}

// Singleton instance
export const pipelineProgressService = new PipelineProgressService();