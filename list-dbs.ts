import "dotenv/config";
import mysql from "mysql2/promise";

async function checkHost(host: string) {
  console.log(`\n=== Checking Host: ${host} ===`);
  try {
    const connection = await mysql.createConnection({
      host: host,
      user: "devxadmin",
      password: "REDACTED_MYSQL_PASSWORD",
      ssl: { rejectUnauthorized: false }
    });

    const [dbs]: any = await connection.query("SHOW DATABASES");
    for (const db of dbs) {
      const dbName = db.Database || db.database;
      try {
        await connection.query(`USE \`${dbName}\``);
        const [tables]: any = await connection.query("SHOW TABLES LIKE 'test_plan_documents'");
        if (tables.length > 0) {
          const [rows]: any = await connection.query("SELECT COUNT(*) as count FROM test_plan_documents");
          console.log(`   DB: ${dbName} -> count: ${rows[0].count}`);
          if (rows[0].count > 0) {
              const [latest]: any = await connection.query("SELECT id, created_at FROM test_plan_documents ORDER BY created_at DESC LIMIT 1");
              console.log(`      Latest ID: ${latest[0].id} (${latest[0].created_at})`);
          }
        }
      } catch (e) {}
    }
    await connection.end();
  } catch (e: any) {
    console.error(`   Failed to connect: ${e.message}`);
  }
}

async function main() {
  await checkHost("devxserver.mysql.database.azure.com");
  await checkHost("qadevxmysqlserver.mysql.database.azure.com");
}

main();
