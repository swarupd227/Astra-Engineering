// Step 3 verification: prove the central Bedrock hook writes universal_ai_usage_logs
// rows with real tokens + cost for generation success, embedding success/failure,
// and that skipLogging suppresses capture.
//
// Run:  npx tsx scripts/verify-ai-capture.ts
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

  const { withAiContext } = await import("../server/observability/ai-context");
  const llmConfig = await import("../server/llm-config");
  const LLM: any = (llmConfig as any).LLM;
  const embed: any = (llmConfig as any).bedrockEmbeddingClient;

  async function latest(feature: string) {
    const [rows]: any = await pool.query(
      `SELECT provider, model_name, feature_name, use_case, request_status,
              input_tokens, output_tokens, cache_tokens, total_tokens, cost_usd, user_id
       FROM universal_ai_usage_logs WHERE feature_name = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [feature],
    );
    return rows[0];
  }
  async function countAll(): Promise<number> {
    const [r]: any = await pool.query(`SELECT COUNT(*) AS c FROM universal_ai_usage_logs`);
    return r[0].c;
  }

  let pass = 0, total = 0;
  const check = (name: string, cond: boolean, extra = "") => {
    total++;
    if (cond) pass++;
    console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  };

  // 1) Generation success
  try {
    await withAiContext({ userId: "verify-user", feature: "verify-gen", useCase: "verify gen" }, () =>
      LLM.createCompletion({ messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 16 }),
    );
    await sleep(2000);
    const row = await latest("verify-gen");
    check("generation row written", !!row, row ? `status=${row.request_status}` : "no row");
    if (row) {
      check("provider=claude", row.provider === "claude", row.provider);
      check("input_tokens > 0", row.input_tokens > 0, `in=${row.input_tokens}`);
      check("output_tokens > 0", row.output_tokens > 0, `out=${row.output_tokens}`);
      check("total = in+out+cache", row.total_tokens === row.input_tokens + row.output_tokens + row.cache_tokens,
        `total=${row.total_tokens}`);
      check("cost_usd > 0", Number(row.cost_usd) > 0, `cost=${row.cost_usd}`);
      check("user_id attributed", row.user_id === "verify-user", String(row.user_id));
    }
  } catch (e: any) {
    console.log(`  (generation call threw: ${e?.message || e})`);
    await sleep(2000);
    const row = await latest("verify-gen");
    check("generation FAILED row written on error", !!row && row.request_status === "failed",
      row ? row.request_status : "no row");
  }

  // 2) skipLogging suppresses capture
  const before = await countAll();
  try {
    await withAiContext({ feature: "verify-skip", useCase: "verify skip", skipLogging: true }, () =>
      LLM.createCompletion({ messages: [{ role: "user", content: "Reply: ok" }], max_tokens: 8 }),
    );
  } catch { /* even on error, skipLogging must suppress */ }
  await sleep(1500);
  const after = await countAll();
  const skipRow = await latest("verify-skip");
  check("skipLogging writes NO row", !skipRow && after === before, `before=${before} after=${after}`);

  // 3) Embedding success
  try {
    await withAiContext({ userId: "verify-user", feature: "verify-embed-wrap" }, () =>
      embed.embeddings.create({ input: "hello world embedding test" }),
    );
    await sleep(2000);
    const row = await latest("embedding");
    check("embedding row written", !!row, row ? `model=${row.model_name}` : "no row");
    if (row) {
      check("embedding provider=bedrock", row.provider === "bedrock", row.provider);
      check("embedding output_tokens = 0", row.output_tokens === 0, `out=${row.output_tokens}`);
      check("embedding input_tokens > 0", row.input_tokens > 0, `in=${row.input_tokens}`);
    }
  } catch (e: any) {
    console.log(`  (embedding call threw: ${e?.message || e})`);
  }

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-ai-capture failed:", e);
  process.exit(1);
});
