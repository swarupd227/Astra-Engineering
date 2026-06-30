// Step 4 verification: a wrapped surface (specs) attributes feature/use_case
// correctly, and the code-generation feature writes NO row (skipLogging).
//
// Run:  npx tsx scripts/verify-attribution.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();

  let pass = 0, total = 0;
  const check = (name: string, cond: boolean, extra = "") => {
    total++; if (cond) pass++;
    console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  };

  // 1) Specs surface → feature='specs'
  const { callLlm } = await import("../server/services/specs-generator/llm-caller");
  try {
    await callLlm({ systemPrompt: "You are terse.", userPrompt: "Reply with the single word: ok", maxTokens: 10 });
  } catch (e: any) {
    console.log(`  (specs call threw: ${e?.message || e})`);
  }
  await sleep(2000);
  const [specsRows]: any = await pool.query(
    `SELECT feature_name, use_case, provider, request_status FROM universal_ai_usage_logs
     WHERE feature_name='specs' ORDER BY created_at DESC LIMIT 1`,
  );
  const specs = specsRows[0];
  check("specs row written with feature='specs'", !!specs, specs ? `use_case=${specs.use_case}` : "no row");
  if (specs) check("specs use_case='specs generation'", specs.use_case === "specs generation", specs.use_case);

  // 2) Code generation → NO row (skipLogging)
  const [cgBefore]: any = await pool.query(
    `SELECT COUNT(*) AS c FROM universal_ai_usage_logs WHERE feature_name='code_generation'`,
  );
  const { generateCodeFromUserStory } = await import("../server/code-generation-service");
  try {
    await generateCodeFromUserStory({ title: "noop helper", description: "return the number 1", acceptanceCriteria: "", storyId: 0 });
  } catch (e: any) {
    console.log(`  (code-gen call threw: ${e?.message || e})`);
  }
  await sleep(2000);
  const [cgAfter]: any = await pool.query(
    `SELECT COUNT(*) AS c FROM universal_ai_usage_logs WHERE feature_name='code_generation'`,
  );
  check("code-generation writes NO row", cgAfter[0].c === cgBefore[0].c, `before=${cgBefore[0].c} after=${cgAfter[0].c}`);

  // cleanup
  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE feature_name IN ('specs') AND use_case='specs generation' AND created_at > (NOW() - INTERVAL 1 HOUR)`);

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("verify-attribution failed:", e); process.exit(1); });
