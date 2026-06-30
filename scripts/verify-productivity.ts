import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
async function main(){
  const { loadSecrets } = await import("../server/secrets-loader"); await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db"); await initializeDatabase();
  const pool = getPool();
  const { getProductivityTarget, upsertProductivityTarget } = await import("../server/observability/productivity");
  let pass=0,total=0; const check=(n:string,c:boolean,e="")=>{total++;if(c)pass++;console.log(`${c?"✓":"✗"} ${n}${e?` — ${e}`:""}`);};
  const ps="2026-05-01", pe="2026-05-31";
  await upsertProductivityTarget({periodType:"monthly",periodStart:ps,periodEnd:pe,targetSavedHours:123.5});
  let v = await getProductivityTarget("monthly",ps,pe);
  check("target read after insert", v===123.5, `got ${v}`);
  await upsertProductivityTarget({periodType:"monthly",periodStart:ps,periodEnd:pe,targetSavedHours:200});
  v = await getProductivityTarget("monthly",ps,pe);
  check("target upsert updates value", v===200, `got ${v}`);
  v = await getProductivityTarget("monthly","2099-01-01","2099-01-31");
  check("missing target returns 0", v===0, `got ${v}`);
  await pool.query(`DELETE FROM productivity_targets WHERE period_start=? AND period_end=?`,[ps,pe]);
  await pool.end();
  console.log(`\n${pass}/${total} checks passed`); process.exit(pass===total?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
