import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
import mysql from "mysql2/promise";
async function main(){
  const { loadSecrets } = await import("../server/secrets-loader"); await loadSecrets();
  const conn = await mysql.createConnection({ host:process.env.MYSQL_HOST, port:+(process.env.MYSQL_PORT||"3306"), user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:"qadevxdb_test3" });
  const q=async(s:string,p:any[]=[])=>(await conn.query(s,p))[0] as any[];
  const acct="712020:9907c53b-bf4e-44d3-a182-0f9d87691679";
  console.log("=== rows for my account_id (full) ===");
  console.table(await q("SELECT project_key, jira_display_name, jira_email, user_id, match_method, active, synced_at FROM jira_team_members WHERE jira_account_id=?",[acct]));
  console.log("=== any rows where jira_email = my email ===");
  console.table(await q("SELECT project_key, jira_email, user_id, match_method FROM jira_team_members WHERE LOWER(jira_email)=LOWER(?)",["omjha@nousinfo.com"]));
  await conn.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
