import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";

export interface ProgressEvent {
  id: string;
  sessionId: string;
  repositoryName: string;
  type: 'repo-creation' | 'pipeline-run' | 'deployment' | 'qa-analysis' | 'ai-fix' | 'health-check';
  stage: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'warning';
  message: string;
  timestamp: Date;
  details?: any;
  fileChanges?: FileChange[];
  duration?: number;
  progress?: number; // 0-100
}

export interface FileChange {
  filePath: string;
  action: 'created' | 'modified' | 'deleted' | 'analyzed' | 'fixed';
  error?: string;
  aiGeneratedFix?: string;
  originalContent?: string;
  newContent?: string;
  status: 'pending' | 'applying' | 'applied' | 'failed';
  timestamp: Date;
}

export interface ProgressSession {
  id: string;
  repositoryName: string;
  organizationName: string;
  projectId: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  events: ProgressEvent[];
  currentStage: string;
  totalStages: number;
  completedStages: number;
  lastUpdate: Date;
}

export class ProgressTrackingService extends EventEmitter {
  private sessions: Map<string, ProgressSession> = new Map();
  private io: SocketIOServer | null = null;

  constructor() {
    super();
  }

  public setSocketIO(io: SocketIOServer) {
    this.io = io;
  }

  public createSession(
    repositoryName: string,
    organizationName: string,
    projectId: string,
    totalStages: number = 5
  ): string {
    const sessionId = randomUUID();
    
    const session: ProgressSession = {
      id: sessionId,
      repositoryName,
      organizationName,
      projectId,
      status: 'active',
      startedAt: new Date(),
      events: [],
      currentStage: 'Initializing',
      totalStages,
      completedStages: 0,
      lastUpdate: new Date()
    };

    this.sessions.set(sessionId, session);
    this.broadcastSessionUpdate(session);

    console.log(`[PROGRESS] Created session ${sessionId} for ${repositoryName}`);
    return sessionId;
  }

  public updateProgress(
    sessionId: string,
    type: ProgressEvent['type'],
    stage: string,
    status: ProgressEvent['status'],
    message: string,
    details?: any,
    fileChanges?: FileChange[],
    progress?: number
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[PROGRESS] Session ${sessionId} not found`);
      return;
    }

    const event: ProgressEvent = {
      id: randomUUID(),
      sessionId,
      repositoryName: session.repositoryName,
      type,
      stage,
      status,
      message,
      timestamp: new Date(),
      details,
      fileChanges,
      progress
    };

    session.events.push(event);
    session.currentStage = stage;
    session.lastUpdate = new Date();

    // Update completed stages count
    if (status === 'completed') {
      session.completedStages = Math.min(session.completedStages + 1, session.totalStages);
    }

    // Update session status based on event status
    if (status === 'failed') {
      session.status = 'failed';
      session.completedAt = new Date();
    } else if (session.completedStages >= session.totalStages && status === 'completed') {
      session.status = 'completed';
      session.completedAt = new Date();
    }

    this.broadcastProgressEvent(event);
    this.broadcastSessionUpdate(session);

    console.log(`[PROGRESS] ${sessionId}: ${stage} - ${status} - ${message}`);
    
    // Emit event for listeners
    this.emit('progress', event);
  }

  public addFileChange(
    sessionId: string,
    filePath: string,
    action: FileChange['action'],
    status: FileChange['status'],
    error?: string,
    aiGeneratedFix?: string,
    originalContent?: string,
    newContent?: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const fileChange: FileChange = {
      filePath,
      action,
      status,
      timestamp: new Date(),
      error,
      aiGeneratedFix,
      originalContent,
      newContent
    };

    // Add to the latest event or create a new one
    const latestEvent = session.events[session.events.length - 1];
    if (latestEvent) {
      if (!latestEvent.fileChanges) latestEvent.fileChanges = [];
      latestEvent.fileChanges.push(fileChange);
    }

    this.broadcastFileChange(sessionId, fileChange);
  }

  public getSession(sessionId: string): ProgressSession | null {
    return this.sessions.get(sessionId) || null;
  }

  public getAllActiveSessions(): ProgressSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  public closeSession(sessionId: string, status: 'completed' | 'failed' | 'cancelled', message?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = status;
    session.completedAt = new Date();

    if (message) {
      this.updateProgress(
        sessionId,
        'deployment',
        'Session Closed',
        status === 'completed' ? 'completed' : 'failed',
        message
      );
    }

    this.broadcastSessionUpdate(session);
    
    // Clean up old sessions after some time
    setTimeout(() => {
      if (this.sessions.get(sessionId)?.status !== 'active') {
        this.sessions.delete(sessionId);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  private broadcastProgressEvent(event: ProgressEvent): void {
    if (!this.io) return;
    
    // Broadcast to all clients interested in this repository
    this.io.to(`repo:${event.repositoryName}`).emit('progress:event', event);
    
    // Broadcast to session-specific room
    this.io.to(`session:${event.sessionId}`).emit('progress:event', event);
  }

  private broadcastSessionUpdate(session: ProgressSession): void {
    if (!this.io) return;
    
    // Send session update
    this.io.to(`repo:${session.repositoryName}`).emit('progress:session', session);
    this.io.to(`session:${session.id}`).emit('progress:session', session);
  }

  private broadcastFileChange(sessionId: string, fileChange: FileChange): void {
    if (!this.io) return;
    
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.io.to(`repo:${session.repositoryName}`).emit('progress:file-change', {
      sessionId,
      repositoryName: session.repositoryName,
      fileChange
    });
  }

  // Utility methods for common progress patterns
  public startRepoCreation(sessionId: string, repoName: string): void {
    this.updateProgress(
      sessionId,
      'repo-creation',
      'Repository Creation',
      'in-progress',
      `Creating repository: ${repoName}`,
      { repoName }
    );
  }

  public startPipeline(sessionId: string, pipelineName: string): void {
    this.updateProgress(
      sessionId,
      'pipeline-run',
      'Pipeline Execution',
      'in-progress',
      `Starting pipeline: ${pipelineName}`,
      { pipelineName }
    );
  }

  public startDeployment(sessionId: string, target: string): void {
    this.updateProgress(
      sessionId,
      'deployment',
      'Deployment',
      'in-progress',
      `Deploying to: ${target}`,
      { target }
    );
  }

  public startQAAnalysis(sessionId: string, url: string): void {
    this.updateProgress(
      sessionId,
      'qa-analysis',
      'Quality Assurance',
      'in-progress',
      `Analyzing deployed application: ${url}`,
      { url }
    );
  }

  public startAIFix(sessionId: string, issueDescription: string, affectedFiles: string[]): void {
    this.updateProgress(
      sessionId,
      'ai-fix',
      'AI Fix Generation',
      'in-progress',
      `Generating AI fix for: ${issueDescription}`,
      { 
        issueDescription,
        affectedFiles,
        aiEngine: 'Azure OpenAI GPT-4'
      }
    );
  }

  public completeStage(
    sessionId: string,
    type: ProgressEvent['type'],
    stage: string,
    message: string,
    result?: any
  ): void {
    this.updateProgress(
      sessionId,
      type,
      stage,
      'completed',
      message,
      result,
      undefined,
      100
    );
  }

  public failStage(
    sessionId: string,
    type: ProgressEvent['type'],
    stage: string,
    error: string,
    details?: any
  ): void {
    this.updateProgress(
      sessionId,
      type,
      stage,
      'failed',
      error,
      details
    );
  }

  /**
   * Check if Socket.IO connection is available
   */
  public hasSocketConnection(): boolean {
    return !!this.io && (this.io as any).engine?.readyState === 'open';
  }

  /**
   * Get debug information about the progress tracking service
   */
  public getDebugInfo(): any {
    return {
      hasSocketIO: !!this.io,
      socketConnected: this.hasSocketConnection(),
      activeSessionsCount: this.sessions.size,
      activeSessions: [...this.sessions.keys()],
      timestamp: new Date().toISOString()
    };
  }
}

// Singleton instance
export const progressTracker = new ProgressTrackingService();