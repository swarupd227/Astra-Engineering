/**
 * Allow page_signature_hash to be NULL so inserts without it don't fail.
 * Usage: npx tsx scripts/fix-page-signature-hash-default.ts
 */
import "dotenv/config";
import { poolConnection } from "../server/db";

async function run() {
  await poolConnection.query(
    "ALTER TABLE automated_test_pages MODIFY COLUMN page_signature_hash VARCHAR(64) NULL DEFAULT NULL"
  );
  console.log("page_signature_hash is now nullable.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
