import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
async function main(){
  const email = process.argv[2] || "omjha@nousinfo.com";
  const { loadSecrets } = await import("../server/secrets-loader"); await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db"); await initializeDatabase();
  const pool = getPool();
  const [u]:any = await pool.query(`SELECT id, email, display_name, tenant_id, is_deleted FROM users WHERE LOWER(TRIM(email))=LOWER(TRIM(?)) LIMIT 1`,[email]);
  if(!u[0]){ console.log(`No DevX user found for ${email}`); await pool.end(); return; }
  const me = u[0];
  console.log(`\nYou: ${me.email}\n  users.id = ${me.id}\n  display_name = ${me.display_name}\n`);
  const [tm]:any = await pool.query(`SELECT project_key, project_name, match_method FROM jira_team_members WHERE user_id=?`,[me.id]);
  console.log(`JIRA project memberships (jira_team_members): ${tm.length}`);
  tm.forEach((r:any)=>console.log(`   - ${r.project_key} (${r.project_name||''}) via ${r.match_method}`));
  const [usg]:any = await pool.query(`SELECT COUNT(*) c, COALESCE(SUM(total_tokens),0) tok, COALESCE(SUM(cost_usd),0) cost FROM universal_ai_usage_logs WHERE user_id=?`,[me.id]);
  console.log(`\nYour captured AI usage (universal_ai_usage_logs): ${usg[0].c} row(s), tokens=${usg[0].tok}, cost=$${usg[0].cost}`);
  const [unmatchedMine]:any = await pool.query(`SELECT COUNT(*) c FROM jira_team_members WHERE LOWER(TRIM(jira_email))=LOWER(TRIM(?)) AND user_id IS NULL`,[email]);
  console.log(`Unmatched JIRA member rows with your email (awaiting claim): ${unmatchedMine[0].c}`);
  await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
