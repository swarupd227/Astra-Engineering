import "dotenv/config";
import mysql from "mysql2/promise";

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const [cols]: any = await connection.query("DESCRIBE test_plan_documents");
    console.table(cols);
    
    const [rows]: any = await connection.query("SELECT id, ado_id FROM test_plan_documents WHERE ado_id IS NOT NULL");
    console.log("Records with ADO_ID:", rows.length);
    
    await connection.end();
    process.exit(0);
  } catch (e: any) {
    console.error("Error:", e.message);
    await connection.end();
    process.exit(1);
  }
}

check();
