#!/usr/bin/env node

/**
 * Test script to verify BRD date capture
 * Run this to test if the date is being captured and sent to the backend
 */

const API_URL = "http://localhost:3000"; // Adjust if needed

async function testBRDDateCapture() {
  const testDate = new Date().toISOString().split("T")[0];
  
  console.log("\n=== BRD Date Capture Test ===");
  console.log(`Current system date: ${testDate}`);
  console.log(`Testing BRD generation with date capture...\n`);

  const payload = {
    projectName: "Test Project",
    projectDescription: "This is a test project to verify date capture",
    businessObjectives: "Test objective",
    generationDate: testDate, // This should be captured by the client
  };

  console.log("Payload being sent to backend:");
  console.log(JSON.stringify(payload, null, 2));
  console.log();

  try {
    const response = await fetch(`${API_URL}/api/brd/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (response.ok && result.brd) {
      console.log("✅ BRD generated successfully!");
      console.log(`Date in response: ${result.brd.date}`);
      
      if (result.brd.date === testDate) {
        console.log("✅ Date matches! Client date was properly used.");
      } else {
        console.log(`⚠️  Date mismatch! Expected ${testDate}, got ${result.brd.date}`);
      }
    } else {
      console.log("❌ Generation failed:", result.error);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("\nMake sure:");
    console.log("1. Dev server is running on port 3000");
    console.log("2. You have valid project and BRD IDs");
  }
}

testBRDDateCapture();
