/**
 * Ralph Loop Testing API Routes
 * Provides endpoints for testing the complete CI/CD pipeline functionality
 */

import { Router } from 'express';
import { RalphLoopService, RalphLoopConfig } from '../services/ralph.loop.service';
import { DeploymentQAAgent } from '../services/deployment.qa.agent';

const router = Router();

/**
 * Test deployment monitoring functionality
 */
router.post('/test-deployment-monitoring', async (req, res) => {
  try {
    const { repositoryName, organization, project } = req.body;

    console.log(`[Ralph Loop Test] Testing deployment monitoring for ${repositoryName}`);

    const config: RalphLoopConfig = {
      organization,
      project,
      pat: process.env.ADO_PAT || 'test-pat',
      maxIterations: 3,
      autoFixEnabled: true,
      targetAppService: `${repositoryName}-app`,
      progressCallback: (stage, status, message) => {
        console.log(`[Test Progress] ${stage}: ${status} - ${message}`);
      }
    };

    const ralphLoop = new RalphLoopService(config);

    // Test the deployment monitoring method
    const isDeployed = await ralphLoop.waitForInitialDeployment(repositoryName);

    res.json({
      success: true,
      deploymentDetected: isDeployed,
      message: 'Deployment monitoring test completed',
      repositoryName,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Ralph Loop Test] Deployment monitoring test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Test QA execution functionality
 */
router.post('/test-qa-execution', async (req, res) => {
  try {
    const { deploymentUrl, repositoryName } = req.body;

    console.log(`[Ralph Loop Test] Testing QA execution for ${deploymentUrl}`);

    const qaAgent = new DeploymentQAAgent({
      maxRetries: 3,
      retryDelay: 1000,
      timeoutMs: 30000
    });

    // Run comprehensive QA test
    const qaResult = await qaAgent.validateDeployment(deploymentUrl, {
      repositoryName,
      organization: 'TestOrg',
      project: 'TestProject'
    });

    res.json({
      success: true,
      qaResult,
      message: 'QA execution test completed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Ralph Loop Test] QA execution test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Test intelligent fixing functionality
 */
router.post('/test-intelligent-fixing', async (req, res) => {
  try {
    const { qaResult, repositoryName } = req.body;

    console.log(`[Ralph Loop Test] Testing intelligent fixing for ${repositoryName}`);

    const config: RalphLoopConfig = {
      organization: 'TestOrg',
      project: 'TestProject',
      pat: process.env.ADO_PAT || 'test-pat',
      maxIterations: 3,
      autoFixEnabled: true,
      targetAppService: `${repositoryName}-app`
    };

    const ralphLoop = new RalphLoopService(config);

    // Test fix generation
    const fixes = await ralphLoop.generateIntelligentFixes(qaResult, repositoryName, 'https://test-app.azurewebsites.net');

    res.json({
      success: true,
      fixesGenerated: fixes.length,
      fixes: fixes.map(fix => ({
        type: fix.type,
        description: fix.description,
        filesAffected: fix.files.length,
        success: fix.success
      })),
      message: 'Intelligent fixing test completed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Ralph Loop Test] Intelligent fixing test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Test redeployment trigger functionality
 */
router.post('/test-redeployment', async (req, res) => {
  try {
    const { repositoryName, fixesApplied } = req.body;

    console.log(`[Ralph Loop Test] Testing redeployment trigger for ${repositoryName}`);

    const config: RalphLoopConfig = {
      organization: 'TestOrg',
      project: 'TestProject',
      pat: process.env.ADO_PAT || 'test-pat',
      maxIterations: 3,
      autoFixEnabled: true,
      targetAppService: `${repositoryName}-app`
    };

    const ralphLoop = new RalphLoopService(config);

    // Test deployment trigger
    const deploymentTriggered = await ralphLoop.triggerDeployment(repositoryName);

    res.json({
      success: true,
      deploymentTriggered,
      fixesApplied: fixesApplied.length,
      message: 'Redeployment trigger test completed',
      repositoryName,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Ralph Loop Test] Redeployment trigger test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Test complete loop functionality
 */
router.post('/test-complete-loop', async (req, res) => {
  try {
    const { repositoryName, organization, project, maxIterations } = req.body;

    console.log(`[Ralph Loop Test] Testing complete loop for ${repositoryName}`);

    const config: RalphLoopConfig = {
      organization: organization || 'TestOrg',
      project: project || 'TestProject',
      pat: process.env.ADO_PAT || 'test-pat',
      maxIterations: maxIterations || 3,
      autoFixEnabled: true,
      targetAppService: `${repositoryName}-app`,
      progressCallback: (stage, status, message) => {
        console.log(`[Test Loop Progress] ${stage}: ${status} - ${message}`);
      }
    };

    const ralphLoop = new RalphLoopService(config);

    // Start the complete loop (this will run the full CI/CD automation)
    const result = await ralphLoop.startLoop(repositoryName);

    res.json({
      success: true,
      result,
      message: 'Complete loop test completed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Ralph Loop Test] Complete loop test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Get Ralph Loop status
 */
router.get('/status', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'READY',
      services: {
        ralphLoop: 'available',
        qaAgent: 'available',
        deploymentService: 'available',
        azureDevOps: 'configured'
      },
      features: {
        deploymentMonitoring: true,
        qaTestExecution: true,
        intelligentFixing: true,
        autoRedeployment: true,
        progressTracking: true
      },
      message: 'Ralph Loop CI/CD Pipeline is ready for testing',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;