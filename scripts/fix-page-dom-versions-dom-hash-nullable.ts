/**
 * Allow dom_hash to be NULL so inserts without it don't fail.
 * Usage: npx tsx scripts/fix-page-dom-versions-dom-hash-nullable.ts
 */
import "dotenv/config";
import { poolConnection } from "../server/db";

async function run() {
  await poolConnection.query(
    "ALTER TABLE page_dom_versions MODIFY COLUMN dom_hash VARCHAR(64) NULL DEFAULT NULL"
  );
  console.log("dom_hash is now nullable.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
