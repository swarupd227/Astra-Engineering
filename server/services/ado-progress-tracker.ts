/**
 * Enhanced Progress Tracking Service for ADO Integration
 * 
 * This service provides better error handling and debugging capabilities
 * for progress tracking during ADO push operations and Ralph Loop activation.
 */

import { ProgressTrackingService } from './progress-tracking.service';
import { EventEmitter } from 'events';

export class ADOProgressTracker extends EventEmitter {
  private progressService: ProgressTrackingService;
  private activeSessions: Map<string, { sessionId: string; repositoryName: string }> = new Map();

  constructor(progressService: ProgressTrackingService) {
    super();
    this.progressService = progressService;
  }

  /**
   * Create a new progress session for ADO push operation
   */
  public createADOPushSession(repositoryName: string, organizationName: string, projectId: string): string {
    console.log(`[ADO-Progress] Creating progress session for ${repositoryName}`);
    
    try {
      const sessionId = this.progressService.createSession(
        repositoryName,
        organizationName,
        projectId,
        7 // ADO push has 7 stages: validation, connection, push, deployment, ralph-loop, qa, completion
      );

      this.activeSessions.set(repositoryName, { sessionId, repositoryName });
      
      console.log(`[ADO-Progress] Created session ${sessionId} for repository ${repositoryName}`);
      
      // Track the initial stage
      this.progressService.updateProgress(
        sessionId,
        'repo-creation',
        'ADO Push Initialization',
        'in-progress',
        'Preparing to push work items to Azure DevOps...',
        { repositoryName, organizationName, projectId }
      );

      return sessionId;
    } catch (error) {
      console.error(`[ADO-Progress] Failed to create session for ${repositoryName}:`, error);
      throw new Error(`Failed to create ADO progress session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Track ADO push validation stage
   */
  public trackValidation(sessionId: string, config: any): void {
    try {
      this.progressService.updateProgress(
        sessionId,
        'pipeline-run',
        'Configuration Validation',
        'in-progress',
        'Validating Azure DevOps configuration and credentials...',
        { 
          organization: config.organization,
          project: config.project,
          hasValidPAT: !!config.pat
        }
      );
    } catch (error) {
      console.error(`[ADO-Progress] Failed to track validation for session ${sessionId}:`, error);
    }
  }

  /**
   * Track successful validation
   */
  public completeValidation(sessionId: string): void {
    try {
      this.progressService.completeStage(
        sessionId,
        'pipeline-run',
        'Configuration Validation',
        'Azure DevOps configuration validated successfully'
      );
    } catch (error) {
      console.error(`[ADO-Progress] Failed to complete validation for session ${sessionId}:`, error);
    }
  }

  /**
   * Track ADO connection and work item push
   */
  public trackWorkItemPush(sessionId: string, itemCounts: { epics: number; features: number; stories: number }): void {
    try {
      const totalItems = itemCounts.epics + itemCounts.features + itemCounts.stories;
      this.progressService.updateProgress(
        sessionId,
        'deployment',
        'Work Items Push',
        'in-progress',
        `Pushing ${totalItems} work items to Azure DevOps...`,
        { 
          totalItems,
          breakdown: itemCounts
        }
      );
    } catch (error) {
      console.error(`[ADO-Progress] Failed to track work item push for session ${sessionId}:`, error);
    }
  }

  /**
   * Track successful work item push
   */
  public completeWorkItemPush(sessionId: string, results: any): void {
    try {
      const createdCount = results.workItemIds?.length || 0;
      const testCases = results.testCasesCreated || 0;
      const subtasks = results.subtasksCreated || 0;
      const total = createdCount + testCases + subtasks;

      this.progressService.completeStage(
        sessionId,
        'deployment',
        'Work Items Push',
        `Successfully created ${total} items in Azure DevOps`,
        {
          workItems: createdCount,
          testCases,
          subtasks,
          url: results.url,
          details: results
        }
      );
    } catch (error) {
      console.error(`[ADO-Progress] Failed to complete work item push for session ${sessionId}:`, error);
    }
  }

  /**
   * Track Ralph Loop activation
   */
  public trackRalphLoopActivation(sessionId: string, repositoryName: string): void {
    try {
      this.progressService.updateProgress(
        sessionId,
        'ai-fix',
        'Ralph Loop Activation',
        'in-progress',
        'Activating Ralph Loop for continuous deployment monitoring...',
        { 
          repositoryName,
          service: 'Ralph Loop',
          features: ['QA Analysis', 'AI Fixing', 'Continuous Improvement']
        }
      );
    } catch (error) {
      console.error(`[ADO-Progress] Failed to track Ralph Loop activation for session ${sessionId}:`, error);
    }
  }

  /**
   * Track Ralph Loop startup completion
   */
  public completeRalphLoopActivation(sessionId: string, ralphSessionId?: string): void {
    try {
      this.progressService.completeStage(
        sessionId,
        'ai-fix',
        'Ralph Loop Activation',
        'Ralph Loop service activated and monitoring deployment',
        {
          ralphSessionId,
          monitoringActive: true,
          nextStage: 'QA Analysis'
        }
      );
    } catch (error) {
      console.error(`[ADO-Progress] Failed to complete Ralph Loop activation for session ${sessionId}:`, error);
    }
  }

  /**
   * Handle progress tracking failures gracefully
   */
  public failStage(sessionId: string, stage: string, error: string, details?: any): void {
    try {
      console.error(`[ADO-Progress] Stage failed - Session: ${sessionId}, Stage: ${stage}, Error: ${error}`);
      
      this.progressService.failStage(
        sessionId,
        'deployment',
        stage,
        error,
        {
          timestamp: new Date().toISOString(),
          details,
          troubleshooting: [
            'Check Azure DevOps credentials',
            'Verify network connectivity',
            'Ensure sufficient permissions',
            'Contact support if issue persists'
          ]
        }
      );

      // Emit failure event for external listeners
      this.emit('stage-failed', { sessionId, stage, error, details });
    } catch (progressError) {
      console.error(`[ADO-Progress] Failed to report stage failure:`, progressError);
    }
  }

  /**
   * Complete entire ADO operation
   */
  public completeADOOperation(sessionId: string, summary: any): void {
    try {
      this.progressService.updateProgress(
        sessionId,
        'health-check',
        'ADO Operation Complete',
        'completed',
        'Azure DevOps push completed successfully - Ralph Loop monitoring active',
        {
          summary,
          completedAt: new Date().toISOString(),
          status: 'success',
          monitoringActive: true
        },
        undefined,
        100
      );

      // Clean up session tracking
      const sessionInfo = [...this.activeSessions.entries()]
        .find(([_, session]) => session.sessionId === sessionId);
      
      if (sessionInfo) {
        this.activeSessions.delete(sessionInfo[0]);
      }

      this.emit('operation-completed', { sessionId, summary });
    } catch (error) {
      console.error(`[ADO-Progress] Failed to complete ADO operation for session ${sessionId}:`, error);
    }
  }

  /**
   * Get active session for repository
   */
  public getActiveSession(repositoryName: string): { sessionId: string; repositoryName: string } | null {
    return this.activeSessions.get(repositoryName) || null;
  }

  /**
   * Check if WebSocket connection is available
   */
  public isConnected(): boolean {
    return !!this.progressService && this.progressService.hasSocketConnection();
  }

  /**
   * Debug method to check progress tracking health
   */
  public debugStatus(): any {
    return {
      activeSessionsCount: this.activeSessions.size,
      activeSessions: [...this.activeSessions.entries()],
      hasProgressService: !!this.progressService,
      isSocketConnected: this.isConnected(),
      timestamp: new Date().toISOString()
    };
  }
}

// Add method to check socket connection in the main progress service
declare module './progress-tracking.service' {
  namespace ProgressTrackingService {
    interface ProgressTrackingService {
      hasSocketConnection(): boolean;
    }
  }
}