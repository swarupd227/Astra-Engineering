/**
 * Per-user Jira PAT credential resolver.
 * Loads, encrypts, decrypts, tests, and constructs JiraService instances
 * from the user_jira_credentials table so every Jira API call is attributed
 * to the real person.
 */

import { db } from '../../db';
import { userJiraCredentials, jiraActionLogs, jiraConnections } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '../../jira-routes';
import { JiraService } from './jira-service';

// ── Custom error classes ──

export class UserJiraCredentialMissingError extends Error {
  readonly code = 'JIRA_PAT_MISSING' as const;
  constructor(userId: string) {
    super(`No active Jira credential found for user ${userId}. Please connect your Jira account.`);
    this.name = 'UserJiraCredentialMissingError';
  }
}

export class UserJiraCredentialInvalidError extends Error {
  readonly code = 'JIRA_PAT_INVALID' as const;
  constructor(userId: string, reason?: string) {
    super(`Jira credential for user ${userId} is invalid${reason ? ': ' + reason : ''}. Please reconnect your Jira account.`);
    this.name = 'UserJiraCredentialInvalidError';
  }
}

// ── Credential CRUD ──

function normalizeInstanceUrl(url: string) {
  return url.replace(/\/+$/, '').toLowerCase();
}

export async function getUserJiraCredential(userId: string, instanceUrl?: string) {
  const creds = await db
    .select()
    .from(userJiraCredentials)
    .where(and(eq(userJiraCredentials.userId, userId), eq(userJiraCredentials.isActive, 1)));
  if (!instanceUrl) return creds[0] ?? null;
  const target = normalizeInstanceUrl(instanceUrl);
  return creds.find((cred) => normalizeInstanceUrl(cred.instanceUrl) === target) ?? null;
}

export async function saveUserJiraCredential(
  userId: string,
  data: { instanceUrl: string; email: string; apiToken: string }
) {
  const instanceUrl = data.instanceUrl.replace(/\/+$/, '');
  const encrypted = encrypt(data.apiToken);

  const existing = await db
    .select()
    .from(userJiraCredentials)
    .where(and(eq(userJiraCredentials.userId, userId), eq(userJiraCredentials.instanceUrl, instanceUrl)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userJiraCredentials)
      .set({
        email: data.email,
        apiTokenEncrypted: encrypted,
        isActive: 1,
        updatedAt: new Date(),
      })
      .where(eq(userJiraCredentials.id, existing[0].id));
    return existing[0].id;
  }

  const id = crypto.randomUUID();
  await db.insert(userJiraCredentials).values({
    id,
    userId,
    instanceUrl,
    email: data.email,
    apiTokenEncrypted: encrypted,
  });
  return id;
}

export async function deleteUserJiraCredential(userId: string, credentialId?: string) {
  if (credentialId) {
    await db
      .update(userJiraCredentials)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(and(eq(userJiraCredentials.id, credentialId), eq(userJiraCredentials.userId, userId)));
  } else {
    await db
      .update(userJiraCredentials)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(eq(userJiraCredentials.userId, userId));
  }
}

// ── JiraService factory ──

export async function getJiraServiceForUser(userId: string, projectKey?: string, instanceUrl?: string): Promise<JiraService> {
  const normalizeUrl = normalizeInstanceUrl;
  const targetInstance = instanceUrl ? normalizeUrl(instanceUrl) : null;

  // Try per-user credentials, filtered by instance URL when available
  const allCreds = await db
    .select()
    .from(userJiraCredentials)
    .where(and(eq(userJiraCredentials.userId, userId), eq(userJiraCredentials.isActive, 1)));

  let cred = targetInstance
    ? allCreds.find(c => normalizeUrl(c.instanceUrl) === targetInstance)
    : allCreds[0] ?? null;

  if (!cred && allCreds.length > 0 && targetInstance) {
    console.warn(`[UserCredResolver] user=${userId} has ${allCreds.length} credential(s) but none match instance ${targetInstance}; skipping per-user path`);
  }

  if (cred) {
    let apiToken: string;
    try {
      apiToken = decrypt(cred.apiTokenEncrypted);
    } catch {
      throw new UserJiraCredentialInvalidError(userId, 'token decryption failed');
    }

    if (!apiToken || apiToken.trim().length === 0) {
      throw new UserJiraCredentialInvalidError(userId, 'decrypted token is empty');
    }

    console.log(`[UserCredResolver] Building JiraService for user=${userId} from per-user credential, instance=${cred.instanceUrl}, projectKey=${projectKey}`);
    return new JiraService({
      instanceUrl: cred.instanceUrl,
      email: cred.email,
      apiToken,
      projectKey,
    });
  }

  // No per-user credential: every user must authenticate Jira with their own PAT.
  // There is intentionally no shared/org-level connection fallback.
  throw new UserJiraCredentialMissingError(userId);
}

/**
 * Build a JiraService from the connection flagged as the "admin connection"
 * for the given Jira instance. Used by operations that require Jira-side
 * global admin rights (e.g. POST /rest/api/3/project), so any teammate can
 * trigger them without each having Site Admin in Jira.
 *
 * Throws if no admin-flagged connection exists for the instance, so callers
 * should map that to a 412 Precondition Required with an actionable message.
 */
export async function getAdminJiraServiceForInstance(instanceUrl: string): Promise<JiraService> {
  const normalize = (url: string) => url.replace(/\/+$/, '').toLowerCase();
  const target = normalize(instanceUrl);

  const candidates = await db
    .select()
    .from(jiraConnections)
    .where(and(eq(jiraConnections.isActive, 1), eq(jiraConnections.isAdminConnection, 1)));

  const conn = candidates.find(c => normalize(c.instanceUrl) === target);
  if (!conn) {
    throw new Error(
      `No admin Jira connection configured for instance ${instanceUrl}. ` +
      `Ask a tenant admin to mark a connection as admin in Settings.`
    );
  }
  if (!conn.email || !conn.apiTokenEncrypted) {
    throw new Error(
      `Admin Jira connection for ${instanceUrl} is missing email or API token; reconfigure it in Settings.`
    );
  }

  let apiToken: string;
  try {
    apiToken = decrypt(conn.apiTokenEncrypted);
  } catch {
    throw new Error(
      `Admin Jira connection token for ${instanceUrl} could not be decrypted; reconfigure it in Settings.`
    );
  }
  if (!apiToken || apiToken.trim().length === 0) {
    throw new Error(
      `Admin Jira connection token for ${instanceUrl} is empty; reconfigure it in Settings.`
    );
  }

  console.log(
    `[UserCredResolver] Building admin JiraService for instance=${conn.instanceUrl} (connectionId=${conn.id})`,
  );
  return new JiraService({
    instanceUrl: conn.instanceUrl,
    email: conn.email,
    apiToken,
  });
}

// ── Test credential ──

export async function testUserJiraCredential(userId: string, instanceUrl?: string): Promise<{
  accountId: string;
  displayName: string;
  emailAddress?: string;
}> {
  const cred = await getUserJiraCredential(userId, instanceUrl);
  if (!cred) throw new UserJiraCredentialMissingError(userId);

  let jiraService: JiraService;
  try {
    jiraService = await getJiraServiceForUser(userId, undefined, instanceUrl || cred.instanceUrl);
  } catch (err) {
    if (err instanceof UserJiraCredentialMissingError || err instanceof UserJiraCredentialInvalidError) throw err;
    throw new UserJiraCredentialInvalidError(userId, err instanceof Error ? err.message : String(err));
  }

  try {
    const user = await jiraService.getCurrentUser();
    if (!user) {
      throw new UserJiraCredentialInvalidError(userId, '/myself returned null');
    }

    await db
      .update(userJiraCredentials)
      .set({
        accountId: user.accountId,
        displayName: user.displayName,
        lastTestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userJiraCredentials.id, cred.id));

    // The user's JIRA account_id is now known. This is the exact moment the
    // credential-tier link becomes possible, so immediately claim any existing
    // unmatched jira_team_members rows for this account_id → users.id. Without
    // this, rows synced BEFORE the user connected their PAT stay 'unmatched'
    // until the next (throttled) login claim or project re-sync. Fire-and-forget.
    import("./team-sync-service")
      .then((m) => m.claimJiraMembershipsForUser({ userId, email: user.emailAddress }))
      .then((n) => { if (n > 0) console.log(`[UserCred] credential-validated: linked ${n} JIRA membership(s) for user ${userId}`); })
      .catch((e) => console.warn("[UserCred] claim after credential validation failed:", e?.message || e));

    return user;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('authentication')) {
      await db
        .update(userJiraCredentials)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(userJiraCredentials.id, cred.id));
      throw new UserJiraCredentialInvalidError(userId, '401 Unauthorized');
    }
    throw err;
  }
}

// ── Activity logging ──

export async function logJiraAction(params: {
  userId: string;
  sdlcProjectId?: string;
  jiraProjectKey?: string;
  action: string;
  issueKey?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
}) {
  try {
    await db.insert(jiraActionLogs).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      sdlcProjectId: params.sdlcProjectId ?? null,
      jiraProjectKey: params.jiraProjectKey ?? null,
      action: params.action,
      issueKey: params.issueKey ?? null,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
    });
  } catch (err) {
    console.warn('[JiraActionLog] Failed to write log:', err instanceof Error ? err.message : err);
  }
}
