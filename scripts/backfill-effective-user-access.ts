import crypto from "crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

if (process.env.DEVX_HOSTING === "aws") {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
}

const apply = process.argv.includes("--apply");

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  charset: "utf8mb4_0900_ai_ci",
  ssl: process.env.MYSQL_SSL === "false" ? undefined : { rejectUnauthorized: false },
});

type UserRow = {
  id: string;
  email: string;
  tenant_id: string | null;
};

const [dbInfo] = await conn.query<any[]>(
  "SELECT DATABASE() AS db, @@hostname AS host, @@port AS port, CURRENT_USER() AS user",
);

const [duplicateEmailRows] = await conn.query<any[]>(`
  SELECT LOWER(email) AS email, COUNT(*) AS count
  FROM users
  WHERE email IS NOT NULL AND email <> '' AND COALESCE(is_deleted, 0) = 0
  GROUP BY LOWER(email)
  HAVING COUNT(*) > 1
`);

let projectMembershipsToCreate = 0;
let organizationMembershipsToCreate = 0;
const examples: any[] = [];

for (const duplicateEmail of duplicateEmailRows) {
  const [users] = await conn.query<UserRow[]>(
    `
      SELECT id, email, tenant_id
      FROM users
      WHERE LOWER(email) = ? AND COALESCE(is_deleted, 0) = 0
      ORDER BY created_at
    `,
    [duplicateEmail.email],
  );
  const userIds = users.map((user) => user.id);
  if (userIds.length < 2) continue;

  const placeholders = userIds.map(() => "?").join(",");

  const [ownedProjects] = await conn.query<any[]>(
    `
      SELECT id, name, owner_user_id
      FROM sdlc_projects
      WHERE owner_user_id IN (${placeholders}) AND COALESCE(deleted_from_ado, 0) = 0
    `,
    userIds,
  );

  for (const project of ownedProjects) {
    for (const user of users) {
      if (!user.tenant_id) continue;
      const [existing] = await conn.query<any[]>(
        "SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1",
        [project.id, user.id],
      );
      if (existing.length) continue;
      projectMembershipsToCreate++;
      examples.push({
        type: "project_member",
        project: project.name,
        projectId: project.id,
        userId: user.id,
        email: user.email,
      });
      if (apply) {
        await conn.query(
          `
            INSERT INTO project_members
              (id, project_id, user_id, tenant_id, role, invited_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            crypto.randomUUID(),
            project.id,
            user.id,
            user.tenant_id,
            user.id === project.owner_user_id ? "owner" : "member",
            project.owner_user_id,
          ],
        );
      }
    }
  }

  const [ownedOrganizations] = await conn.query<any[]>(
    `
      SELECT id, name, owner_user_id
      FROM organizations
      WHERE owner_user_id IN (${placeholders})
    `,
    userIds,
  );

  for (const organization of ownedOrganizations) {
    for (const user of users) {
      if (!user.tenant_id) continue;
      const [existing] = await conn.query<any[]>(
        "SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ? LIMIT 1",
        [organization.id, user.id],
      );
      if (existing.length) continue;
      organizationMembershipsToCreate++;
      examples.push({
        type: "organization_member",
        organization: organization.name,
        organizationId: organization.id,
        userId: user.id,
        email: user.email,
      });
      if (apply) {
        await conn.query(
          `
            INSERT INTO organization_members
              (id, organization_id, user_id, tenant_id, role, invited_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            crypto.randomUUID(),
            organization.id,
            user.id,
            user.tenant_id,
            user.id === organization.owner_user_id ? "owner" : "member",
            organization.owner_user_id,
          ],
        );
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      db: dbInfo[0],
      duplicateEmailGroups: duplicateEmailRows.length,
      projectMembershipsToCreate,
      organizationMembershipsToCreate,
      examples: examples.slice(0, 25),
    },
    null,
    2,
  ),
);

await conn.end();
