import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
import { randomUUID } from "node:crypto";
async function main(){
  const { loadSecrets } = await import("../server/secrets-loader"); await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db"); await initializeDatabase();
  const pool = getPool();
  const { buildAiMetricsResponse } = await import("../server/services/ai-metrics-service");
  const INST="https://devxnous.atlassian.net/";
  const TESTHILPR="dfdec1a2-cadb-4d58-9c48-babe63490e1d", OAT="3d48e427-b70a-488e-9464-9673d89f9869";
  const U="pw-user";
  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id=?`,[U]);
  const ins=(proj:string)=>pool.query(`INSERT INTO universal_ai_usage_logs (id,user_id,project_id,provider,model_name,feature_name,use_case,request_status,quality_decision,input_tokens,output_tokens,cache_tokens,total_tokens,cost_usd,currency,created_at) VALUES (?,?,?,'claude','test','brd','brd generation','success','unrated',10,5,0,15,'0.001','USD','2026-06-15 10:00:00')`,[randomUUID(),U,proj]);
  await ins(TESTHILPR); await ins(TESTHILPR); await ins(TESTHILPR);  // 3 for TESTHILPR
  await ins(OAT); await ins(OAT);                                    // 2 for OAT

  let pass=0,total=0; const check=(n:string,c:boolean,e="")=>{total++;if(c)pass++;console.log(`${c?"✓":"✗"} ${n}${e?` — ${e}`:""}`);};

  const rH = await buildAiMetricsResponse({startDate:"2026-06-01",endDate:"2026-06-30",periodType:"monthly",jiraInstance:INST,jiraProject:"TestPrHilti"});
  const tH = rH.teams.find(t=>t.team_id==="TESTHILPR"); const uH = rH.users.find(u=>u.user_id===U);
  check("TESTHILPR team total_requests = 3", tH?.total_requests===3, String(tH?.total_requests));
  check("pw-user under TESTHILPR period=3", uH?.period_ai_uses===3, String(uH?.period_ai_uses));
  // top-level scoped to the project now (3 TESTHILPR rows: 30/15 in, etc.)
  check("TESTHILPR top-level usage scoped = 3", rH.usage.total_requests===3, String(rH.usage.total_requests));
  check("TESTHILPR top-level tokens scoped (in=30)", rH.tokens.input_tokens===30, String(rH.tokens.input_tokens));

  const rO = await buildAiMetricsResponse({startDate:"2026-06-01",endDate:"2026-06-30",periodType:"monthly",jiraInstance:INST,jiraProject:"OAT"});
  const tO = rO.teams.find(t=>t.team_id==="OAT"); const uO = rO.users.find(u=>u.user_id===U);
  check("OAT team total_requests = 2 (NOT 5)", tO?.total_requests===2, String(tO?.total_requests));
  check("pw-user under OAT period=2 (no overlap)", uO?.period_ai_uses===2, String(uO?.period_ai_uses));
  check("OAT top-level usage scoped = 2 (NOT 5)", rO.usage.total_requests===2, String(rO.usage.total_requests));

  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id=?`,[U]);
  await pool.end();
  console.log(`\n${pass}/${total} checks passed`); process.exit(pass===total?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
