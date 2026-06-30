/**
 * Add missing snake_case columns to automated_test_pages if the table was created with wrong structure.
 * Usage: npx tsx scripts/add-automated-test-pages-columns.ts
 */
import "dotenv/config";
import { poolConnection } from "../server/db";

const COLUMNS: { name: string; def: string }[] = [
  { name: "crawl_run_id", def: "CHAR(36) NOT NULL DEFAULT ''" },
  { name: "page_type", def: "VARCHAR(100) DEFAULT 'page'" },
  { name: "route_pattern", def: "VARCHAR(512) NOT NULL DEFAULT ''" },
  { name: "sample_url", def: "VARCHAR(2048) NOT NULL DEFAULT ''" },
  { name: "user_role", def: "VARCHAR(100) DEFAULT 'default'" },
  { name: "page_signature_hash", def: "VARCHAR(64)" },
  { name: "title", def: "VARCHAR(512)" },
  { name: "depth", def: "INT NOT NULL DEFAULT 0" },
  { name: "parent_page_id", def: "VARCHAR(36)" },
  { name: "link_count", def: "INT NOT NULL DEFAULT 0" },
  { name: "form_count", def: "INT NOT NULL DEFAULT 0" },
  { name: "element_count", def: "INT NOT NULL DEFAULT 0" },
  { name: "created_at", def: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL" },
];

async function run() {
  for (const { name, def } of COLUMNS) {
    try {
      await poolConnection.query(
        `ALTER TABLE automated_test_pages ADD COLUMN \`${name}\` ${def}`
      );
      console.log("Added column:", name);
    } catch (e: any) {
      if (e?.code === "ER_DUP_FIELDNAME") {
        console.log("Column already exists:", name);
      } else {
        throw e;
      }
    }
  }
  console.log("Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
