/**
 * Simple test to verify deployment service functionality
 * Run this manually to test deployment without affecting current flows
 */

import { DeploymentService } from '../services/deployment.service';

async function testDeploymentService() {
  console.log('=== Testing Deployment Service ===');
  
  // These values should be replaced with actual values when testing
  const testConfig = {
    organization: 'InsurityPOC', // Replace with your Azure DevOps organization
    project: 'InsurityPOC', // Replace with your project ID
    pat: process.env.AZURE_DEVOPS_PAT || 'your-pat-token-here', // Set in environment
    branch: 'develop'
  };
  
  if (!process.env.AZURE_DEVOPS_PAT) {
    console.error('❌ Please set AZURE_DEVOPS_PAT environment variable');
    return;
  }
  
  try {
    const deploymentService = new DeploymentService(testConfig);
    
    // Test repository ID - replace with actual repository ID when testing
    const testRepoId = 'test-repo-id';
    
    console.log(`🚀 Starting deployment test for repository: ${testRepoId}`);
    console.log(`📋 Config: ${testConfig.organization}/${testConfig.project}, branch: ${testConfig.branch}`);
    
    const result = await deploymentService.deployRepo(testRepoId);
    
    console.log('📊 Deployment Result:');
    console.log(`   Status: ${result.status}`);
    console.log(`   Health URL: ${result.healthUrl || 'N/A'}`);
    console.log(`   Build ID: ${result.buildId || 'N/A'}`);
    
    if (result.logs) {
      console.log('📋 Deployment Logs:');
      console.log(result.logs);
    }
    
    if (result.status === 'SUCCESS') {
      console.log('✅ Deployment test completed successfully!');
      
      if (result.healthUrl) {
        console.log(`🔍 You can test the health endpoint at: ${result.healthUrl}`);
      }
    } else {
      console.log('❌ Deployment test failed');
    }
    
  } catch (error) {
    console.error('💥 Test failed with error:', error);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDeploymentService();
}

export { testDeploymentService };