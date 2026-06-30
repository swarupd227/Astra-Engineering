import { DefaultAzureCredential } from '@azure/identity';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { ResourceManagementClient } from '@azure/arm-resources';

async function testAzureProvisioning() {
  console.log('=== Azure Provisioning Test ===');

  try {
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || '93e72167-374e-4039-bd33-1012ae37cafb';
    const resourceGroupName = 'RG-DevXPlatform';
    const region = 'canadacentral';

    console.log('1. Initializing Azure credentials...');
    const credential = new DefaultAzureCredential();

    console.log('2. Creating Azure clients...');
    const webSiteClient = new WebSiteManagementClient(credential, subscriptionId);
    const resourceClient = new ResourceManagementClient(credential, subscriptionId);

    console.log('3. Verifying resource group exists...');
    const rg = await resourceClient.resourceGroups.get(resourceGroupName);
    console.log(`Resource Group found: ${rg.name} in ${rg.location}`);

    console.log('4. Testing App Service Plan creation...');
    const testPlanName = `test-plan-${Date.now()}`;
    console.log(`Creating test plan: ${testPlanName}`);

    const appServicePlan = await webSiteClient.appServicePlans.beginCreateOrUpdateAndWait(
      resourceGroupName,
      testPlanName,
      {
        location: 'Canada Central',
        sku: { name: 'B1', tier: 'Basic', capacity: 1 },
        kind: 'linux',
        reserved: true, // Required for Linux plans
      }
    );

    console.log(`App Service Plan created successfully: ${appServicePlan.id}`);

    console.log('5. Waiting for App Service Plan to be fully available...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('6. Verifying App Service Plan exists...');
    const verifyPlan = await webSiteClient.appServicePlans.get(resourceGroupName, testPlanName);
    console.log(`Plan verified: ${verifyPlan.name} - Status: ${verifyPlan.status}`);

    console.log('7. Testing App Service creation...');
    const testAppName = `test-app-${Date.now()}`;
    console.log(`Creating test app: ${testAppName}`);

    const webApp = await webSiteClient.webApps.beginCreateOrUpdateAndWait(
      resourceGroupName,
      testAppName,
      {
        location: 'Canada Central',
        serverFarmId: appServicePlan.id,
        siteConfig: {
          appSettings: [
            { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' },
            { name: 'WEBSITES_PORT', value: '3000' },
            { name: 'NODE_ENV', value: 'development' },
          ],
          linuxFxVersion: 'NODE|20-lts',
          nodeVersion: '~20',
        },
        tags: {
          environment: 'test',
          createdBy: 'DevX-Test',
        },
      }
    );

    console.log(`App Service created successfully: ${webApp.defaultHostName}`);
    console.log(`URL: https://${webApp.defaultHostName}`);

    console.log('8. Testing cleanup...');
    console.log('Deleting App Service...');
    await webSiteClient.webApps.delete(resourceGroupName, testAppName);
    console.log('App Service deleted successfully');

    console.log('Deleting App Service Plan...');
    await webSiteClient.appServicePlans.delete(resourceGroupName, testPlanName);
    console.log('App Service Plan deleted successfully');

    console.log('✅ All tests passed! Azure provisioning is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error.response) {
      console.error('Response details:', error.response.data);
    }
  }
}

// Run the test
testAzureProvisioning().catch(console.error);
