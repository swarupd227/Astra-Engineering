import { db } from "./server/db";
import { artifactOrganizations } from "./shared/schema";
import { decryptPAT } from "./server/crypto-utils";
import fetch from "node-fetch";

async function checkOrgs() {
  try {
    const orgs = await db.select().from(artifactOrganizations);
    console.log(`Found ${orgs.length} organizations.`);
    
    for (const org of orgs) {
      console.log(`\nOrganization: ${org.organizationUrl}`);
      console.log(`ID: ${org.id}`);
      console.log(`Project Name: ${org.projectName}`);
      
      if (!org.patToken) {
        console.log("Status: No PAT token configured.");
        continue;
      }
      
      try {
        const decryptedPAT = decryptPAT(org.patToken);
        if (!decryptedPAT) {
          console.log("Status: Failed to decrypt PAT token.");
          continue;
        }
        
        console.log("Status: Decrypted PAT token successfully.");
        
        // Try to fetch projects for this org
        let orgName = org.organizationUrl
          .replace(/https?:\/\/dev\.azure\.com\//, "")
          .replace(/\/$/, "");
        
        const url = `https://dev.azure.com/${orgName}/_apis/projects?api-version=7.0`;
        const authToken = Buffer.from(`:${decryptedPAT}`).toString('base64');
        
        console.log(`Testing API connectivity to: ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`Status: SUCCESS! Found ${result.value?.length || 0} projects.`);
        } else {
          const errorText = await response.text();
          console.log(`Status: FAILED. HTTP ${response.status} - ${errorText.substring(0, 100)}...`);
        }
      } catch (err) {
        console.log(`Status: ERROR during API test: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("Critical error:", err);
  } finally {
    process.exit(0);
  }
}

checkOrgs();
