
import { db } from "../server/db";
import { crawlRuns, automatedTestCases, automatedTestScripts } from "../shared/schema";
import { desc, eq } from "drizzle-orm";

async function diag() {
  console.log("Checking recent crawl runs...");
  try {
    const runs = await db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(5);
    console.log(JSON.stringify(runs, null, 2));

    for (const run of runs) {
      console.log(`\nRun ${run.id}:`);
      const cases = await db.select().from(automatedTestCases).where(eq(automatedTestCases.crawlRunId, run.id));
      console.log(`- Test cases: ${cases.length}`);
      
      const scripts = await db.select().from(automatedTestScripts).where(eq(automatedTestScripts.crawlRunId, run.id));
      console.log(`- Scripts: ${scripts.length}`);
    }
  } catch (err) {
    console.error("Database error:", err);
  }
  process.exit(0);
}

diag().catch(err => {
  console.error(err);
  process.exit(1);
});
