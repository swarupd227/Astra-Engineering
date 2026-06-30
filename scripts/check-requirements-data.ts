import { config } from "dotenv";
import mysql from "mysql2/promise";

// Load environment variables
config();

async function checkRequirements() {
  console.log("🔍 Checking requirements data...\n");
  
  const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };

  let connection: mysql.Connection | null = null;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log("✅ Connected to database\n");

    // Get the project ID for "Moon"
    const [projects] = await connection.query(
      `SELECT id, name, ado_project_id FROM sdlc_projects WHERE name LIKE '%Moon%' OR ado_project_id LIKE '%Moon%'`
    );

    console.log("📋 Projects matching 'Moon':");
    console.table(projects);

    if (Array.isArray(projects) && projects.length > 0) {
      const projectId = (projects as any)[0].id;
      console.log(`\n🎯 Checking requirements for project ID: ${projectId}\n`);

      // Check dev_brd_requirements table
      const [requirements] = await connection.query(
        `SELECT id, title, phase_number, created_at 
         FROM dev_brd_requirements 
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
        [projectId]
      );

      console.log("📝 Requirements in dev_brd_requirements:");
      if (Array.isArray(requirements) && requirements.length > 0) {
        console.table(requirements);
      } else {
        console.log("❌ No requirements found!");
        console.log("\n💡 To create requirements:");
        console.log("   1. Go to Workflow page");
        console.log("   2. Select or create a BRD");
        console.log("   3. Enter requirements in Step 1");
        console.log("   4. Generate artifacts");
      }

      // Check workflow_artifacts table for requirements
      const [artifacts] = await connection.query(
        `SELECT id, requirement, requirement_ids, created_at 
         FROM workflow_artifacts 
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 5`,
        [projectId]
      );

      console.log("\n📦 Workflow Artifacts:");
      if (Array.isArray(artifacts) && artifacts.length > 0) {
        console.table(artifacts);
      } else {
        console.log("❌ No workflow artifacts found!");
      }
    }

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    if (connection) {
      await connection.end();
      console.log("\n🔌 Database connection closed");
    }
  }
}

checkRequirements()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
