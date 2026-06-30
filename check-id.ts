import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  console.log(`Checking Host: ${process.env.MYSQL_HOST}, DB: ${process.env.MYSQL_DATABASE}`);
  try {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: { rejectUnauthorized: false }
    });

    const id = '96e4d281-9bfb-404e-882c-d60218836eaa';
    const [rows]: any = await connection.query("SELECT * FROM test_plan_documents WHERE id = ?", [id]);
    if (rows.length > 0) {
      console.log("✅ Record Found!");
      console.log(JSON.stringify(rows[0], null, 2));
    } else {
      console.log("❌ Record NOT FOUND in this DB.");
    }
    await connection.end();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
