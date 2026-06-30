import { db } from "./server/db";
import { artifactOrganizations } from "./shared/schema";
import { decryptPAT } from "./server/crypto-utils";

async function checkOrgs() {
  try {
    const orgs = await db.select().from(artifactOrganizations);
    console.log(`TOTAL_ORGS: ${orgs.length}`);
    
    for (const org of orgs) {
      console.log(`ORG_ID: ${org.id}`);
      console.log(`ORG_URL: ${org.organizationUrl}`);
      
      if (!org.patToken) {
        console.log(`PAT_STATUS: MISSING`);
      } else {
        const decryptedPAT = decryptPAT(org.patToken);
        if (!decryptedPAT) {
          console.log(`PAT_STATUS: DECRYPTION_FAILED`);
        } else {
          console.log(`PAT_STATUS: DECRYPTED_OK`);
          console.log(`PAT_LENGTH: ${decryptedPAT.length}`);
          // Just first and last char for debugging without exposing full PAT
          console.log(`PAT_PREVIEW: ${decryptedPAT[0]}...${decryptedPAT[decryptedPAT.length-1]}`);
        }
      }
      console.log("---");
    }
  } catch (err) {
    console.error("DIAGNOSTIC_ERROR:", err.message);
  } finally {
    process.exit(0);
  }
}

checkOrgs();
