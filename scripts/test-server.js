// Simple test to verify server is working
console.log('=== Server Health Check ===');

async function testEndpoints() {
  try {
    // Test basic server response
    const response = await fetch('http://localhost:4000/api/health');
    if (response.ok) {
      console.log('✅ Server is running and healthy');
    } else {
      console.log('❌ Server health check failed');
    }
  } catch (error) {
    console.log('❌ Server is not accessible:', error.message);
  }

  try {
    // Test instances endpoint (will likely need auth but we can see the response)
    const response = await fetch('http://localhost:4000/api/instances');
    console.log(`Instances endpoint status: ${response.status} - ${response.statusText}`);
  } catch (error) {
    console.log('❌ Instances endpoint error:', error.message);
  }
}

testEndpoints().catch(console.error);
