/**
 * Progress Tracking Health Check Service
 * 
 * This service provides endpoints to test and verify that progress tracking
 * is working correctly when pushing to ADO.
 */

import express from 'express';
import { randomUUID } from 'crypto';

const router = express.Router();

// Test endpoint to verify progress tracking is working
router.get('/health', async (req, res) => {
  try {
    const { progressTracker } = await import('../services/progress-tracking.service');
    const { ADOProgressTracker } = await import('../services/ado-progress-tracker');
    
    const debugInfo = progressTracker.getDebugInfo();
    const testSessionId = randomUUID();
    
    // Test creating a session
    const sessionId = progressTracker.createSession(
      'test-repo',
      'test-org', 
      'test-project',
      5
    );
    
    // Test updating progress
    progressTracker.updateProgress(
      sessionId,
      'deployment',
      'Health Check Test',
      'in-progress',
      'Testing progress tracking functionality...'
    );
    
    // Complete the test
    progressTracker.completeStage(
      sessionId,
      'deployment',
      'Health Check Test',
      'Progress tracking test completed successfully'
    );
    
    // Close the session
    progressTracker.closeSession(sessionId, 'completed', 'Health check completed');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      progressTracking: {
        available: true,
        socketConnected: debugInfo.socketConnected,
        debugInfo
      },
      testResults: {
        sessionCreated: !!sessionId,
        progressUpdated: true,
        sessionCompleted: true
      }
    });
    
  } catch (error) {
    console.error('[Progress Health] Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Test endpoint to simulate ADO push progress tracking
router.post('/simulate-ado-push', async (req, res) => {
  try {
    const { repositoryName = 'test-repo', organizationName = 'test-org', projectId = 'test-project' } = req.body;
    
    const { progressTracker } = await import('../services/progress-tracking.service');
    const { ADOProgressTracker } = await import('../services/ado-progress-tracker');
    
    const adoProgressTracker = new ADOProgressTracker(progressTracker);
    
    // Create a test ADO push session
    const sessionId = adoProgressTracker.createADOPushSession(repositoryName, organizationName, projectId);
    
    // Simulate the ADO push workflow with delays
    setTimeout(() => {
      adoProgressTracker.trackValidation(sessionId, {
        organization: organizationName,
        project: projectId,
        pat: '***'
      });
    }, 500);
    
    setTimeout(() => {
      adoProgressTracker.completeValidation(sessionId);
    }, 1000);
    
    setTimeout(() => {
      adoProgressTracker.trackWorkItemPush(sessionId, {
        epics: 2,
        features: 5,
        stories: 10
      });
    }, 1500);
    
    setTimeout(() => {
      adoProgressTracker.completeWorkItemPush(sessionId, {
        workItemIds: ['1', '2', '3'],
        testCasesCreated: 5,
        subtasksCreated: 8,
        url: 'https://dev.azure.com/test-org/test-project'
      });
    }, 2500);
    
    setTimeout(() => {
      adoProgressTracker.trackRalphLoopActivation(sessionId, repositoryName);
    }, 3000);
    
    setTimeout(() => {
      adoProgressTracker.completeRalphLoopActivation(sessionId, randomUUID());
    }, 3500);
    
    setTimeout(() => {
      adoProgressTracker.completeADOOperation(sessionId, {
        totalItems: 17,
        workItems: 3,
        testCases: 5,
        subtasks: 8,
        wikiPages: 1,
        ralphLoopActive: true
      });
    }, 4000);
    
    res.json({
      success: true,
      message: 'ADO push simulation started',
      sessionId,
      repositoryName,
      organizationName,
      projectId,
      expectedDuration: '4 seconds',
      note: 'Check the progress tracking panel to see the simulated workflow'
    });
    
  } catch (error) {
    console.error('[Progress Health] ADO push simulation failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Get current WebSocket connection status
router.get('/websocket-status', async (req, res) => {
  try {
    const { progressTracker } = await import('../services/progress-tracking.service');
    
    const debugInfo = progressTracker.getDebugInfo();
    
    res.json({
      websocket: {
        connected: debugInfo.socketConnected,
        hasSocketIO: debugInfo.hasSocketIO,
        activeSessionsCount: debugInfo.activeSessionsCount,
        activeSessions: debugInfo.activeSessions
      },
      server: {
        timestamp: debugInfo.timestamp,
        environment: process.env.NODE_ENV || 'development'
      }
    });
    
  } catch (error) {
    console.error('[Progress Health] WebSocket status check failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

export default router;