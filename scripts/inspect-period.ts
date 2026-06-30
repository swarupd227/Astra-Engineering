import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
async function main(){
  const { loadSecrets } = await import("../server/secrets-loader"); await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db"); await initializeDatabase();
  const pool = getPool();
  const W = ["2026-06-01","2026-07-01"];
  const g = async (sql:string)=>{ const [r]:any = await pool.query(sql, W); return r; };
  console.log("\n-- by feature_name --");
  console.table(await g(`SELECT feature_name, COUNT(*) c, SUM(quality_decision='accepted') accepted, SUM(quality_decision='unrated') unrated FROM universal_ai_usage_logs WHERE created_at>=? AND created_at<? GROUP BY feature_name`));
  console.log("-- by use_case --");
  console.table(await g(`SELECT use_case, COUNT(*) c FROM universal_ai_usage_logs WHERE created_at>=? AND created_at<? GROUP BY use_case`));
  console.log("-- by provider/model --");
  console.table(await g(`SELECT provider, model_name, COUNT(*) c FROM universal_ai_usage_logs WHERE created_at>=? AND created_at<? GROUP BY provider, model_name`));
  console.log("-- by user_id --");
  console.table(await g(`SELECT user_id, COUNT(*) c FROM universal_ai_usage_logs WHERE created_at>=? AND created_at<? GROUP BY user_id`));
  await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
