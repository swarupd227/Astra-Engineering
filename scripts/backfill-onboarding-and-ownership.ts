/**
 * Grandfathering / backfill migration for the per-user PAT onboarding +
 * org/project ownership feature.
 *
 *  1. Marks users as onboarded when they already hold an active JIRA PAT AND an
 *     active GitLab PAT (per-user GitLab is net-new, so in practice most users
 *     will still need to add GitLab and will enter the flow on next login).
 *  2. Backfills owner membership rows for existing organizations/projects that
 *     already have an owner_user_id set (e.g. created after the column was added
 *     but before membership rows were written).
 *
 * Idempotent: safe to re-run. Run with:  tsx scripts/backfill-onboarding-and-ownership.ts
 */
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

for (const key of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
  if (!process.env[key]) {
    throw new Error(`${key} environment variable is required. Set it in your .env file or environment.`);
  }
}

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST!,
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`Connected to ${process.env.MYSQL_HOST}/${process.env.MYSQL_DATABASE}`);

    // 1. Grandfather users who already have BOTH an active JIRA and GitLab PAT.
    const [result]: any = await connection.query(
      `UPDATE users u
         SET u.onboarding_completed = 1,
             u.onboarding_completed_at = NOW()
       WHERE u.onboarding_completed = 0
         AND EXISTS (
           SELECT 1 FROM user_jira_credentials j
            WHERE j.user_id = u.id AND j.is_active = 1
         )
         AND EXISTS (
           SELECT 1 FROM user_git_credentials g
            WHERE g.user_id = u.id AND g.provider = 'gitlab' AND g.is_active = 1
         )`
    );
    console.log(`✓ Marked ${result.affectedRows ?? 0} user(s) as onboarded (had active JIRA + GitLab PATs).`);

    // 2. Backfill owner membership rows for orgs/projects that have an owner set
    //    but no corresponding membership row yet.
    const [orgs]: any = await connection.query(
      `SELECT o.id, o.owner_user_id, o.tenant_id
         FROM organizations o
        WHERE o.owner_user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM organization_members m
             WHERE m.organization_id = o.id AND m.user_id = o.owner_user_id
          )`
    );
    for (const o of orgs) {
      await connection.query(
        `INSERT INTO organization_members (id, organization_id, user_id, tenant_id, role)
         VALUES (?, ?, ?, ?, 'owner')`,
        [randomUUID(), o.id, o.owner_user_id, o.tenant_id || '']
      );
    }
    console.log(`✓ Backfilled ${orgs.length} organization owner membership row(s).`);

    const [projs]: any = await connection.query(
      `SELECT p.id, p.owner_user_id, o.tenant_id
         FROM projects p
         LEFT JOIN organizations o ON o.id = p.organization_id
        WHERE p.owner_user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM project_members m
             WHERE m.project_id = p.id AND m.user_id = p.owner_user_id
          )`
    );
    for (const p of projs) {
      await connection.query(
        `INSERT INTO project_members (id, project_id, user_id, tenant_id, role)
         VALUES (?, ?, ?, ?, 'owner')`,
        [randomUUID(), p.id, p.owner_user_id, p.tenant_id || '']
      );
    }
    console.log(`✓ Backfilled ${projs.length} project owner membership row(s).`);

    console.log('\n✅ Backfill complete.');
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
