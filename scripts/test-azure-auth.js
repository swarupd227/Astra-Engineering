#!/usr/bin/env node

/**
* Test script to verify Azure authentication and permissions
* Run this to check if Azure CLI is properly configured
*/

import { DefaultAzureCredential } from '@azure/identity';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { ResourceManagementClient } from '@azure/arm-resources';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAzureAuth() {
  console.log('🔍 Testing Azure Authentication...\n');

  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log(`  AZURE_SUBSCRIPTION_ID: ${process.env.AZURE_SUBSCRIPTION_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`  AZURE_TENANT_ID: ${process.env.AZURE_TENANT_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`  AZURE_CLIENT_ID: ${process.env.AZURE_CLIENT_ID ? '✅ Set' : '⚠️ Not set (using CLI auth)'}`);
  console.log(`  AZURE_CLIENT_SECRET: ${process.env.AZURE_CLIENT_SECRET ? '✅ Set' : '⚠️ Not set (using CLI auth)'}`);
  console.log('');

  if (!process.env.AZURE_SUBSCRIPTION_ID) {
    console.log('❌ AZURE_SUBSCRIPTION_ID is required. Please add it to your .env file');
    return;
  }

  try {
    // Test DefaultAzureCredential
    console.log('🔐 Testing DefaultAzureCredential...');
    const credential = new DefaultAzureCredential();
    const subscriptionClient = new SubscriptionClient(credential);

    // Test subscription access
    console.log('📋 Testing subscription access...');
    const subscriptions = subscriptionClient.subscriptions.list();

    let subscriptionCount = 0;
    let targetSubscription = null;

    for await (const subscription of subscriptions) {
      subscriptionCount++;
      console.log(`  Subscription: ${subscription.displayName} (${subscription.subscriptionId})`);

      if (subscription.subscriptionId === process.env.AZURE_SUBSCRIPTION_ID) {
        targetSubscription = subscription;
      }
    }

    if (subscriptionCount === 0) {
      console.log('❌ No subscriptions found. Check Azure CLI authentication:');
      console.log('   Run: az login');
      return;
    }

    if (!targetSubscription) {
      console.log(`❌ Target subscription ${process.env.AZURE_SUBSCRIPTION_ID} not found`);
      console.log('   Available subscriptions listed above');
      return;
    }

    console.log(`✅ Found target subscription: ${targetSubscription.displayName}`);

    // Test resource group access
    console.log('\n🗂️ Testing resource group access...');
    const resourceClient = new ResourceManagementClient(credential, process.env.AZURE_SUBSCRIPTION_ID);

    const resourceGroups = resourceClient.resourceGroups.list();
    let rgCount = 0;

    for await (const rg of resourceGroups) {
      rgCount++;
      console.log(`  Resource Group: ${rg.name} (${rg.location})`);

      if (rgCount >= 5) {
        console.log('  ... (showing first 5)');
        break;
      }
    }

    if (rgCount === 0) {
      console.log('⚠️ No resource groups found, but this is okay');
    }

    console.log(`\n✅ Azure authentication test completed successfully!`);
    console.log(`✅ Found ${subscriptionCount} subscription(s) and ${rgCount} resource group(s)`);
    console.log('\n🚀 Azure provisioning should work now');

  } catch (error) {
    console.error('\n❌ Azure authentication test failed:');
    console.error(`Error: ${error.message}`);
    console.error('\nTroubleshooting steps:');
    console.error('1. Run: az login');
    console.error('2. Run: az account set --subscription <subscription-id>');
    console.error('3. Ensure you have Contributor role on the subscription');
    console.error('4. Check .env file has correct AZURE_SUBSCRIPTION_ID and AZURE_TENANT_ID');
  }
}

// Run the test
testAzureAuth().catch(console.error);
