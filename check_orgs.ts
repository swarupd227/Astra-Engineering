import { db } from "./server/db";
import { artifactOrganizations } from "./shared/schema";

async function checkOrgs() {
  try {
    const orgs = await db.select().from(artifactOrganizations);
    console.log("Found organizations:", JSON.stringify(orgs, null, 2));
  } catch (err) {
    console.error("Error fetching organizations:", err);
  } finally {
    process.exit(0);
  }
}

checkOrgs();
