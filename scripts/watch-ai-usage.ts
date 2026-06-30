// Read-only live tail of universal_ai_usage_logs — use while clicking through the
// UI to confirm each AI action is captured (and code-gen is NOT).
//
// Run:  npx tsx scripts/watch-ai-usage.ts
// Optional filter by feature: npx tsx scripts/watch-ai-usage.ts brd
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();

const featureFilter = process.argv[2]; // optional

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();

  console.log(`\nWatching universal_ai_usage_logs on ${process.env.MYSQL_DATABASE}` +
    (featureFilter ? ` (feature='${featureFilter}')` : "") + ` — Ctrl+C to stop\n`);

  let lastSeen = new Date(Date.now() - 60_000); // show the last minute on start

  setInterval(async () => {
    try {
      const where = featureFilter
        ? `created_at > ? AND feature_name = ?`
        : `created_at > ?`;
      const params = featureFilter ? [lastSeen, featureFilter] : [lastSeen];
      const [rows]: any = await pool.query(
        `SELECT created_at, feature_name, use_case, provider, model_name, request_status,
                quality_decision, input_tokens, output_tokens, cache_tokens, total_tokens,
                cost_usd, user_id
           FROM universal_ai_usage_logs
          WHERE ${where}
          ORDER BY created_at ASC`,
        params,
      );
      for (const r of rows) {
        lastSeen = new Date(r.created_at);
        console.log(
          `[${new Date(r.created_at).toISOString()}] ${r.feature_name?.padEnd(18)} ` +
          `${r.request_status?.padEnd(7)} q=${(r.quality_decision || "").padEnd(8)} ` +
          `tok(in/out/cache/total)=${r.input_tokens}/${r.output_tokens}/${r.cache_tokens}/${r.total_tokens} ` +
          `cost=$${r.cost_usd} provider=${r.provider} user=${r.user_id ?? "-"}`,
        );
      }
    } catch (e: any) {
      console.error("[watch] query error:", e?.message || e);
    }
  }, 2000);
}

main().catch((e) => { console.error(e); process.exit(1); });
