import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
async function main(){
  const { loadSecrets } = await import("../server/secrets-loader"); await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db"); await initializeDatabase();
  const pool = getPool();
  const { lazyResyncIfStale } = await import("../server/integrations/jira/team-sync-service");
  const { buildAiMetricsResponse } = await import("../server/services/ai-metrics-service");
  const INST = "https://jiratest26.atlassian.net", PROJ = "DEMO26";
  let pass=0,total=0; const check=(n:string,c:boolean,e="")=>{total++;if(c)pass++;console.log(`${c?"✓":"✗"} ${n}${e?` — ${e}`:""}`);};

  // 1) backdate → stale → re-syncs (true)
  await pool.query(`UPDATE jira_team_members SET synced_at=(NOW() - INTERVAL 2 HOUR) WHERE LOWER(project_key)='demo26'`);
  check("stale → re-synced", (await lazyResyncIfStale(INST,PROJ)) === true);

  // 2) just synced → fresh → skipped (false)
  check("fresh (within TTL) → skipped", (await lazyResyncIfStale(INST,PROJ)) === false);

  // 3) backdate again → stale → re-syncs (true)
  await pool.query(`UPDATE jira_team_members SET synced_at=(NOW() - INTERVAL 2 HOUR) WHERE LOWER(project_key)='demo26'`);
  check("stale again → re-synced", (await lazyResyncIfStale(INST,PROJ)) === true);

  // 4) e2e metrics with jira params returns the team
  const r = await buildAiMetricsResponse({ startDate:"2026-06-01", endDate:"2026-06-30", periodType:"monthly", jiraInstance:INST, jiraProject:PROJ });
  check("metrics returns DEMO26 team", r.teams.some(t=>t.team_id==="DEMO26"), `teams=${r.teams.map(t=>t.team_id).join(",")}`);

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`); process.exit(pass===total?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
