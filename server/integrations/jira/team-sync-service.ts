/**
 * JIRA team sync + user mapping for the Polaris metrics endpoint.
 *
 * Given a JIRA instance URL + project (name OR key), fetch the project's
 * assignable users and map each JIRA accountId to our users.id via a tiered
 * resolver, persisting into jira_team_members. Manual overrides
 * (jira_user_overrides) are sticky and win over heuristics.
 *
 * Tiers (first match wins):
 *   1. manual      — jira_user_overrides (admin-set, survives re-sync)
 *   2. credential  — user_jira_credentials.account_id (user connected their PAT)
 *   3. email       — users.email == jira.emailAddress (normalized)
 *   4. display_name — users.display_name == jira.displayName (unique both sides)
 *   5. unmatched   — user_id = null
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, getPool } from "../../db";
import {
  jiraSettings,
  sdlcProjects,
  users,
  userJiraCredentials,
  jiraUserOverrides,
  jiraTeamMembers,
} from "@shared/schema";
import { JiraService } from "./jira-service";
import { decrypt as decryptJiraToken } from "../../jira-routes";

export type MatchMethod = "manual" | "credential" | "propagated" | "email" | "display_name" | "unmatched";

const MATCH_CONFIDENCE: Record<MatchMethod, number> = {
  manual: 1,
  credential: 1,
  propagated: 0.95, // inherited from the same JIRA account already matched in another project
  email: 0.9,
  display_name: 0.6,
  unmatched: 0,
};

interface ResolvedProject {
  instanceUrl: string;
  projectKey: string;
  projectName?: string;
  projectId?: string; // our sdlc_projects.id
  email: string;
  apiToken: string;
}

function normInstance(url: string): string {
  return (url || "").replace(/\/+$/, "").trim().toLowerCase();
}
function normText(s?: string | null): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find the project(s) matching instance + project (key OR name) from jira_settings,
 * decrypting credentials so we can call JIRA.
 */
export async function resolveProjects(
  instanceUrl: string,
  project?: string,
): Promise<ResolvedProject[]> {
  const cleanInstance = normInstance(instanceUrl);
  const rows = await db
    .select({
      projectId: jiraSettings.projectId,
      projectKey: jiraSettings.projectKey,
      instanceUrl: jiraSettings.instanceUrl,
      email: jiraSettings.email,
      apiTokenEncrypted: jiraSettings.apiTokenEncrypted,
      projectName: sdlcProjects.name,
    })
    .from(jiraSettings)
    .leftJoin(sdlcProjects, eq(jiraSettings.projectId, sdlcProjects.id))
    .where(
      and(
        sql`LOWER(TRIM(TRAILING '/' FROM ${jiraSettings.instanceUrl})) = ${cleanInstance}`,
        eq(jiraSettings.isActive, true),
      ),
    );

  const wanted = normText(project);
  const out: ResolvedProject[] = [];
  for (const r of rows) {
    const keyMatch = normText(r.projectKey) === wanted;
    const nameMatch = !!r.projectName && normText(r.projectName) === wanted;
    if (wanted && !keyMatch && !nameMatch) continue;
    if (!r.apiTokenEncrypted || !r.email) continue;
    let apiToken = "";
    try {
      apiToken = decryptJiraToken(r.apiTokenEncrypted);
    } catch {
      continue;
    }
    if (!apiToken) continue;
    out.push({
      instanceUrl: r.instanceUrl,
      projectKey: r.projectKey,
      projectName: r.projectName ?? undefined,
      projectId: r.projectId ?? undefined,
      email: r.email,
      apiToken,
    });
  }
  return out;
}

interface ResolvedUser {
  userId: string | null;
  method: MatchMethod;
}

/**
 * Tiered resolver: JIRA accountId/email/displayName -> users.id.
 */
export async function resolveUser(
  cleanInstance: string,
  jira: { accountId: string; emailAddress?: string; displayName?: string },
): Promise<ResolvedUser> {
  // 1) manual override
  const override = await db
    .select({ userId: jiraUserOverrides.userId })
    .from(jiraUserOverrides)
    .where(
      and(
        sql`LOWER(TRIM(TRAILING '/' FROM ${jiraUserOverrides.instanceUrl})) = ${cleanInstance}`,
        eq(jiraUserOverrides.jiraAccountId, jira.accountId),
      ),
    )
    .limit(1);
  if (override[0]?.userId) return { userId: override[0].userId, method: "manual" };

  // 1.5) propagate: this same JIRA accountId is already mapped to a user in
  // another project/row (e.g. a project where JIRA exposed their email). JIRA
  // hides email inconsistently per project, so inherit the known mapping.
  const propagated = await db
    .select({ userId: jiraTeamMembers.userId })
    .from(jiraTeamMembers)
    .where(
      and(
        sql`LOWER(TRIM(TRAILING '/' FROM ${jiraTeamMembers.instanceUrl})) = ${cleanInstance}`,
        eq(jiraTeamMembers.jiraAccountId, jira.accountId),
        sql`${jiraTeamMembers.userId} IS NOT NULL`,
      ),
    )
    .limit(1);
  if (propagated[0]?.userId) return { userId: propagated[0].userId, method: "propagated" };

  // 2) credential link (user connected their own JIRA PAT)
  const cred = await db
    .select({ userId: userJiraCredentials.userId })
    .from(userJiraCredentials)
    .where(eq(userJiraCredentials.accountId, jira.accountId))
    .limit(1);
  if (cred[0]?.userId) return { userId: cred[0].userId, method: "credential" };

  // 3) email match
  const email = normText(jira.emailAddress);
  if (email) {
    const byEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`LOWER(TRIM(${users.email})) = ${email}`, eq(users.isDeleted, false)))
      .limit(2);
    if (byEmail.length === 1) return { userId: byEmail[0].id, method: "email" };
  }

  // 4) unique display-name match
  const dn = normText(jira.displayName);
  if (dn) {
    const byName = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`LOWER(TRIM(${users.displayName})) = ${dn}`, eq(users.isDeleted, false)))
      .limit(2);
    if (byName.length === 1) return { userId: byName[0].id, method: "display_name" };
  }

  return { userId: null, method: "unmatched" };
}

async function upsertMember(member: {
  userId: string | null;
  jiraAccountId: string;
  jiraDisplayName?: string;
  jiraEmail?: string;
  instanceUrl: string;
  projectId?: string;
  projectKey: string;
  projectName?: string;
  active: boolean;
  matchMethod: MatchMethod;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO jira_team_members
       (id, user_id, jira_account_id, jira_display_name, jira_email, instance_url,
        project_id, project_key, project_name, active, match_method, match_confidence, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       jira_display_name = VALUES(jira_display_name),
       jira_email = VALUES(jira_email),
       project_id = VALUES(project_id),
       project_name = VALUES(project_name),
       active = VALUES(active),
       match_method = VALUES(match_method),
       match_confidence = VALUES(match_confidence),
       synced_at = NOW()`,
    [
      randomUUID(),
      member.userId,
      member.jiraAccountId,
      member.jiraDisplayName ?? null,
      member.jiraEmail ?? null,
      member.instanceUrl,
      member.projectId ?? null,
      member.projectKey,
      member.projectName ?? null,
      member.active ? 1 : 0,
      member.matchMethod,
      MATCH_CONFIDENCE[member.matchMethod],
    ],
  );
}

export interface TeamSyncResult {
  projectsResolved: number;
  members: number;
  matched: number;
  unmatched: number;
  byMethod: Record<string, number>;
}

/**
 * Sync members for the given instance + project (name or key). Returns a summary.
 */
export async function syncJiraTeam(params: {
  instanceUrl: string;
  project?: string;
}): Promise<TeamSyncResult> {
  const cleanInstance = normInstance(params.instanceUrl);
  const projects = await resolveProjects(params.instanceUrl, params.project);
  const result: TeamSyncResult = {
    projectsResolved: projects.length,
    members: 0,
    matched: 0,
    unmatched: 0,
    byMethod: {},
  };

  for (const proj of projects) {
    const jira = new JiraService({
      instanceUrl: proj.instanceUrl,
      projectKey: proj.projectKey,
      email: proj.email,
      apiToken: proj.apiToken,
    } as any);

    const assignable = await jira.getAssignableUsers(proj.projectKey, "", 1000);
    for (const u of assignable) {
      const resolved = await resolveUser(cleanInstance, u);
      await upsertMember({
        userId: resolved.userId,
        jiraAccountId: u.accountId,
        jiraDisplayName: u.displayName,
        jiraEmail: u.emailAddress,
        instanceUrl: proj.instanceUrl,
        projectId: proj.projectId,
        projectKey: proj.projectKey,
        projectName: proj.projectName,
        active: u.active,
        matchMethod: resolved.method,
      });
      result.members++;
      if (resolved.userId) result.matched++;
      else result.unmatched++;
      result.byMethod[resolved.method] = (result.byMethod[resolved.method] ?? 0) + 1;
    }
  }
  return result;
}

// Lazy re-sync staleness window (default 10 min). Tunable via env.
const DEFAULT_SYNC_TTL_MS = Number(process.env.POLARIS_JIRA_SYNC_TTL_MS) || 10 * 60 * 1000;

/**
 * Re-sync a project's members only if its last sync is older than the TTL (or it
 * has never been synced). Used by the metrics endpoint so newly-added JIRA
 * members appear automatically without hammering JIRA on every request.
 * Returns true if a sync ran. Never throws.
 */
export async function lazyResyncIfStale(
  instanceUrl: string,
  project: string,
  ttlMs: number = DEFAULT_SYNC_TTL_MS,
): Promise<boolean> {
  try {
    const cleanInstance = normInstance(instanceUrl);
    const proj = normText(project);
    const ttlSec = Math.max(0, Math.ceil(ttlMs / 1000));
    // Staleness is computed entirely in SQL so DB/JS timezone differences can't
    // skew it. NULL MAX (never synced) counts as stale.
    const [rows]: any = await getPool().query(
      `SELECT (MAX(synced_at) IS NULL OR MAX(synced_at) < (NOW() - INTERVAL ? SECOND)) AS stale
         FROM jira_team_members
        WHERE LOWER(TRIM(TRAILING '/' FROM instance_url)) = ?
          AND (LOWER(project_key) = ? OR LOWER(project_name) = ?)`,
      [ttlSec, cleanInstance, proj, proj],
    );
    const stale = Number(rows[0]?.stale) === 1;
    if (!stale) return false; // still fresh
    await syncJiraTeam({ instanceUrl, project });
    return true;
  } catch (e: any) {
    console.warn("[team-sync] lazyResyncIfStale failed:", e?.message || e);
    return false;
  }
}

/**
 * Org onboarding: sync EVERY active JIRA project (optionally limited to one
 * instance). Call this when an org is added so all members/projects are fetched
 * and stored up front. Returns a per-project summary.
 */
export async function syncAllProjects(instanceUrl?: string): Promise<{
  projects: number;
  results: Array<TeamSyncResult & { projectKey: string; instanceUrl: string }>;
}> {
  const rows = await db
    .select({ instanceUrl: jiraSettings.instanceUrl, projectKey: jiraSettings.projectKey })
    .from(jiraSettings)
    .where(eq(jiraSettings.isActive, true));
  const want = instanceUrl ? normInstance(instanceUrl) : null;
  const targets = rows.filter((r) => !want || normInstance(r.instanceUrl) === want);

  const results: Array<TeamSyncResult & { projectKey: string; instanceUrl: string }> = [];
  for (const t of targets) {
    const res = await syncJiraTeam({ instanceUrl: t.instanceUrl, project: t.projectKey });
    results.push({ ...res, projectKey: t.projectKey, instanceUrl: t.instanceUrl });
  }
  return { projects: targets.length, results };
}

/**
 * Login-time reconciliation: when a (possibly new) Cognito user is known, claim
 * any still-unmatched jira_team_members rows that belong to them. Maps a user the
 * instant they log in, without waiting for the next full re-sync.
 *
 * Matches by (a) connected JIRA PAT accountId, (b) sticky manual override,
 * (c) email. Returns how many membership rows were claimed.
 */
export async function claimJiraMembershipsForUser(params: {
  userId: string;
  email?: string;
}): Promise<number> {
  const pool = getPool();
  let affected = 0;

  // (a) credential: user connected their own JIRA PAT (account_id known)
  const [r1]: any = await pool.query(
    `UPDATE jira_team_members jtm
       JOIN user_jira_credentials ujc
         ON ujc.account_id COLLATE utf8mb4_unicode_ci = jtm.jira_account_id
        SET jtm.user_id = ?, jtm.match_method = 'credential', jtm.match_confidence = 1, jtm.synced_at = NOW()
      WHERE jtm.user_id IS NULL AND ujc.user_id = ?`,
    [params.userId, params.userId],
  );
  affected += r1?.affectedRows || 0;

  // (b) sticky manual override for this user
  const [r2]: any = await pool.query(
    `UPDATE jira_team_members jtm
       JOIN jira_user_overrides o
         ON o.jira_account_id = jtm.jira_account_id
        AND LOWER(TRIM(TRAILING '/' FROM o.instance_url)) = LOWER(TRIM(TRAILING '/' FROM jtm.instance_url))
        SET jtm.user_id = o.user_id, jtm.match_method = 'manual', jtm.match_confidence = 1, jtm.synced_at = NOW()
      WHERE o.user_id = ?`,
    [params.userId],
  );
  affected += r2?.affectedRows || 0;

  // (c) email match (only fills still-unmatched rows)
  if (params.email) {
    const [r3]: any = await pool.query(
      `UPDATE jira_team_members
          SET user_id = ?, match_method = 'email', match_confidence = 0.9, synced_at = NOW()
        WHERE user_id IS NULL AND LOWER(TRIM(jira_email)) = LOWER(TRIM(?))`,
      [params.userId, params.email],
    );
    affected += r3?.affectedRows || 0;
  }

  return affected;
}

/**
 * Admin override: link a JIRA accountId to a users.id (sticky). Re-applies the
 * mapping to any existing jira_team_members rows for that account.
 */
export async function setJiraUserOverride(params: {
  instanceUrl: string;
  jiraAccountId: string;
  userId: string;
  createdBy?: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO jira_user_overrides (id, instance_url, jira_account_id, user_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), created_by = VALUES(created_by), created_at = NOW()`,
    [randomUUID(), params.instanceUrl, params.jiraAccountId, params.userId, params.createdBy ?? null],
  );
  // Re-apply to existing membership rows.
  await pool.query(
    `UPDATE jira_team_members
        SET user_id = ?, match_method = 'manual', match_confidence = 1, synced_at = NOW()
      WHERE jira_account_id = ?
        AND LOWER(TRIM(TRAILING '/' FROM instance_url)) = ?`,
    [params.userId, params.jiraAccountId, normInstance(params.instanceUrl)],
  );
}
