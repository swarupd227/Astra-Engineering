/**
 * Fix automated_test_pages unique key: drop uk_page_type_route_role (page_type, route_pattern, user_role)
 * and ensure unique on (crawl_run_id, route_pattern, user_role) so the same route can exist in different runs.
 * Usage: npx tsx scripts/fix-automated-test-pages-unique-key.ts
 */
import "dotenv/config";
import { poolConnection } from "../server/db";

async function run() {
  try {
    await poolConnection.query(
      "ALTER TABLE automated_test_pages DROP INDEX uk_page_type_route_role"
    );
    console.log("Dropped unique key uk_page_type_route_role");
  } catch (e: any) {
    if (e?.code === "ER_CANT_DROP_FIELD_OR_KEY" || e?.errno === 1091) {
      console.log("uk_page_type_route_role does not exist (already dropped)");
    } else {
      throw e;
    }
  }

  try {
    await poolConnection.query(
      "ALTER TABLE automated_test_pages ADD UNIQUE KEY automated_test_pages_run_route_role (crawl_run_id, route_pattern, user_role)"
    );
    console.log("Added unique key automated_test_pages_run_route_role (crawl_run_id, route_pattern, user_role)");
  } catch (e: any) {
    if (e?.code === "ER_DUP_KEYNAME" || e?.errno === 1061) {
      console.log("automated_test_pages_run_route_role already exists");
    } else {
      throw e;
    }
  }

  console.log("Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
