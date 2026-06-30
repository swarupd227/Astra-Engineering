import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: { rejectUnauthorized: false }
    });

    const id = '96e4d281-9bfb-404e-882c-d60218836eaa';
    const adoId = '103554'; // Typical ADO ID from user's environment if known, or dummy
    // Since I don't know the REAL ADO ID created, I'll check if they have one in the latest records of ANOTHER table if possible?
    // No, I'll just ask the user to TRY A NEW ONE after my timeout fixes.
    
    // Actually, I'll just check if the column exists and print the table structure.
    const [cols]: any = await connection.query("DESCRIBE test_plan_documents");
    console.table(cols);

    await connection.end();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
