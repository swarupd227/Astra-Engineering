/**
 * Add project_id and organization_id to crawl_runs. Run once.
 * Usage: npx tsx scripts/add-crawl-runs-columns.ts
 */
import "dotenv/config";
import { poolConnection } from "../server/db";

async function run() {
  try {
    await poolConnection.query("ALTER TABLE crawl_runs ADD COLUMN project_id VARCHAR(36)");
    console.log("Added project_id");
  } catch (e: any) {
    if (e?.code !== "ER_DUP_FIELDNAME") throw e;
    console.log("project_id already exists");
  }
  try {
    await poolConnection.query("ALTER TABLE crawl_runs ADD COLUMN organization_id VARCHAR(36)");
    console.log("Added organization_id");
  } catch (e: any) {
    if (e?.code !== "ER_DUP_FIELDNAME") throw e;
    console.log("organization_id already exists");
  }
  console.log("Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
