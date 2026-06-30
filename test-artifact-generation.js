#!/usr/bin/env node

/**
 * Test script to verify artifact generation is working
 * Run with: node test-artifact-generation.js
 */

const http = require('http');

const testRequirement = `Build a modern e-commerce platform with the following capabilities:
- Product catalog with search, filtering, and recommendations
- Shopping cart with multi-currency support
- Secure checkout process with multiple payment options
- Order management and tracking
- Customer reviews and ratings
- Admin dashboard for inventory and order management
- Mobile responsive design
- Integration with email notifications and analytics

Target Users: Both B2C customers and business administrators
Key Features: Catalog, Cart, Checkout, Orders, Reviews, Admin Dashboard
Technical Constraints: RESTful API, React frontend, Node.js backend, PostgreSQL database, AWS deployment
Functional Requirements: Product management, user authentication, payment processing, email notifications
Non-Functional Requirements: Performance, scalability, security, 99.9% uptime
Edge Cases: Concurrent purchases, inventory conflicts, payment failures
Priority Items: Core checkout flow, product catalog, user authentication`;

const payload = {
  requirement: testRequirement,
  complianceGuidelines: [],
  selectedPersonaIds: []
};

console.log('🧪 Testing Artifact Generation API...');
console.log('━'.repeat(60));
console.log('Sending request to: http://localhost:3000/api/workflow/generate-artifacts');
console.log('━'.repeat(60));

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/workflow/generate-artifacts',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`\n📊 Response Status: ${res.statusCode}`);
    console.log('━'.repeat(60));

    try {
      const result = JSON.parse(data);
      
      if (res.statusCode === 200) {
        console.log('✅ SUCCESS: Artifacts generated successfully!\n');
        console.log(`📈 Generated Artifacts:`);
        console.log(`   • Epics: ${result.epics?.length || 0}`);
        console.log(`   • Features: ${result.features?.length || 0}`);
        console.log(`   • User Stories: ${result.userStories?.length || 0}`);
        console.log(`   • Personas: ${result.personas?.length || 0}`);
        
        if (result.epics && result.epics.length > 0) {
          console.log(`\n📋 Sample Epic:`);
          const firstEpic = result.epics[0];
          console.log(`   • ID: ${firstEpic.id}`);
          console.log(`   • Title: ${firstEpic.title}`);
          console.log(`   • Priority: ${firstEpic.priority}`);
        }

        if (result.features && result.features.length > 0) {
          console.log(`\n📋 Sample Feature:`);
          const firstFeature = result.features[0];
          console.log(`   • ID: ${firstFeature.id}`);
          console.log(`   • Title: ${firstFeature.title}`);
          console.log(`   • Epic ID: ${firstFeature.epicId}`);
        }

        if (result.userStories && result.userStories.length > 0) {
          console.log(`\n📋 Sample User Story:`);
          const firstStory = result.userStories[0];
          console.log(`   • ID: ${firstStory.id}`);
          console.log(`   • Title: ${firstStory.title}`);
          console.log(`   • Feature ID: ${firstStory.featureId}`);
          console.log(`   • Epic ID: ${firstStory.epicId}`);
          if (firstStory.acceptanceCriteria && firstStory.acceptanceCriteria.length > 0) {
            console.log(`   • Acceptance Criteria: ${firstStory.acceptanceCriteria.length} AC(s)`);
          }
          if (firstStory.subtasks && firstStory.subtasks.length > 0) {
            console.log(`   • Subtasks: ${firstStory.subtasks.length} task(s)`);
          }
        }

        console.log('\n✅ Artifact generation is working correctly!');
      } else {
        console.log('❌ ERROR: Artifact generation failed!\n');
        console.log(`Error: ${result.error}`);
        console.log(`\nDetails: ${result.details || 'N/A'}`);
      }
    } catch (e) {
      console.log('❌ ERROR: Failed to parse response!');
      console.log(`Parse Error: ${e.message}`);
      console.log(`\nRaw Response:\n${data.substring(0, 500)}`);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Connection Error:', error.message);
  console.log('\n💡 Make sure the server is running on http://localhost:3000');
});

req.write(JSON.stringify(payload));
req.end();

console.log('\n⏳ Waiting for response (this may take 30-60 seconds)...\n');
