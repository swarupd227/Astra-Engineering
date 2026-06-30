#!/usr/bin/env node

/**
 * Quick test to verify GET /api/workflow/artifacts/:artifactId endpoint works
 * Run from terminal: node test-artifact-endpoint.js
 */

const http = require('http');

const artifactId = 'test-artifact-1'; // Replace with an actual artifact ID from your DB
const testUrl = `http://localhost:3000/api/workflow/artifacts/${artifactId}`;

console.log(`\n🧪 Testing: ${testUrl}\n`);

const req = http.get(testUrl, {
  headers: {
    'Content-Type': 'application/json',
  }
}, (res) => {
  let data = '';
  
  console.log(`Status: ${res.statusCode}`);
  console.log(`Content-Type: ${res.headers['content-type']}\n`);
  
  res.on('data', chunk => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response Body:');
    console.log('==============');
    
    // Try to parse as JSON
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
      
      if (json.artifact) {
        console.log('\n✅ SUCCESS: Artifact found!');
        console.log(`  - Epics: ${Array.isArray(json.artifact.epics) ? json.artifact.epics.length : 'not-array'}`);
        console.log(`  - Features: ${Array.isArray(json.artifact.features) ? json.artifact.features.length : 'not-array'}`);
        console.log(`  - Stories: ${Array.isArray(json.artifact.userStories) ? json.artifact.userStories.length : 'not-array'}`);
      } else {
        console.log('\n⚠️  WARNING: Response is JSON but no "artifact" field found');
      }
    } catch (e) {
      console.log('❌ ERROR: Response is NOT valid JSON\n');
      console.log('First 500 chars of response:');
      console.log(data.substring(0, 500));
      console.log('\nThis likely means the endpoint is returning HTML (SPA fallback)');
      console.log('Check if: 1) Backend is running, 2) Endpoint is registered, 3) ArtifactId exists');
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Connection Error: ${e.message}`);
  console.error('\nMake sure backend server is running on port 3000');
});

setTimeout(() => {
  console.error('\n❌ Timeout: No response from server after 5 seconds');
  process.exit(1);
}, 5000);
