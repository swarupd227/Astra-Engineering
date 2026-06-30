/**
 * Per-user Git hosting credential resolver (GitLab / GitHub / Bitbucket).
 * One implementation, dispatched on `provider`, backed by the
 * user_git_credentials table. Every Git API call is attributed to the real
 * person via their own PAT — there is no shared/tenant-level fallback.
 *
 * Adding a provider = one entry in PROVIDERS below; no new table, no new resolver.
 */

import { db } from '../../db';
import { userGitCredentials, userProjectRepoCredentials } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { encryptPAT, decryptPAT } from '../../crypto-utils';

export type GitProvider = 'gitlab' | 'github' | 'bitbucket';

interface ProviderSpec {
  /** Default API/instance base URL when the caller doesn't supply one. */
  defaultBaseUrl: string;
  /** Build the "current user" validation URL from the stored base URL. */
  buildUserUrl: (baseUrl: string) => string;
  /** Auth headers for this provider given the raw token. */
  authHeaders: (token: string) => Record<string, string>;
  /** Extract { externalUserId, username } from the provider's user payload. */
  parseUser: (payload: any) => { externalUserId: string; username: string };
}

// NOTE on base_url semantics:
//  - gitlab: stored as the *instance* root (e.g. https://gitlab.com); API is {base}/api/v4
//  - github: stored as the *API* root (https://api.github.com, or {host}/api/v3 for Enterprise)
//  - bitbucket: stored as the *API* root (https://api.bitbucket.org/2.0)
const PROVIDERS: Record<GitProvider, ProviderSpec> = {
  gitlab: {
    defaultBaseUrl: 'https://gitlab.com',
    buildUserUrl: (base) => `${base}/api/v4/user`,
    authHeaders: (t) => ({ 'PRIVATE-TOKEN': t }),
    parseUser: (u) => ({ externalUserId: String(u.id), username: u.username }),
  },
  github: {
    defaultBaseUrl: 'https://api.github.com',
    buildUserUrl: (base) => `${base}/user`,
    authHeaders: (t) => ({ Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' }),
    parseUser: (u) => ({ externalUserId: String(u.id), username: u.login }),
  },
  bitbucket: {
    defaultBaseUrl: 'https://api.bitbucket.org/2.0',
    buildUserUrl: (base) => `${base}/user`,
    authHeaders: (t) => ({ Authorization: `Bearer ${t}` }),
    parseUser: (u) => ({ externalUserId: String(u.account_id ?? u.uuid ?? ''), username: u.username ?? u.nickname ?? '' }),
  },
};

export function isGitProvider(value: string): value is GitProvider {
  return value === 'gitlab' || value === 'github' || value === 'bitbucket';
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeProviderBaseUrl(provider: GitProvider, rawUrl: string): string {
  const fallback = PROVIDERS[provider].defaultBaseUrl;
  const normalized = normalizeUrl(rawUrl.trim() || fallback);
  if (provider !== 'gitlab') return normalized;

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/, '');

    // Public GitLab profile/project URLs are often pasted into the instance URL
    // field. Store the instance root so validation calls https://gitlab.com/api/v4/user.
    if ((parsed.hostname === 'gitlab.com' || parsed.hostname === 'www.gitlab.com') && path && path !== '/') {
      return `${parsed.protocol}//${parsed.hostname}`;
    }

    // If someone pastes an API endpoint, normalize it back to the API root.
    const apiIndex = path.toLowerCase().indexOf('/api/v4');
    if (apiIndex >= 0) {
      return `${parsed.protocol}//${parsed.host}${path.slice(0, apiIndex)}`;
    }
  } catch {
    return normalized;
  }

  return normalized;
}

// ── Custom error classes (code is provider-specific, e.g. GITLAB_PAT_MISSING) ──

export class UserGitCredentialMissingError extends Error {
  readonly code: string;
  constructor(public readonly provider: GitProvider, userId: string) {
    super(`No active ${provider} credential found for user ${userId}. Please connect your ${provider} account.`);
    this.name = 'UserGitCredentialMissingError';
    this.code = `${provider.toUpperCase()}_PAT_MISSING`;
  }
}

export class UserGitCredentialInvalidError extends Error {
  readonly code: string;
  constructor(public readonly provider: GitProvider, userId: string, reason?: string) {
    super(`${provider} credential for user ${userId} is invalid${reason ? ': ' + reason : ''}. Please reconnect your ${provider} account.`);
    this.name = 'UserGitCredentialInvalidError';
    this.code = `${provider.toUpperCase()}_PAT_INVALID`;
  }
}

// ── Credential CRUD ──

export async function getUserGitCredential(userId: string, provider: GitProvider, baseUrl?: string) {
  const conds = [
    eq(userGitCredentials.userId, userId),
    eq(userGitCredentials.provider, provider),
    eq(userGitCredentials.isActive, 1),
  ];
  if (baseUrl) conds.push(eq(userGitCredentials.baseUrl, normalizeProviderBaseUrl(provider, baseUrl)));

  const [cred] = await db
    .select()
    .from(userGitCredentials)
    .where(and(...conds))
    .limit(1);
  return cred ?? null;
}

export async function getUserProjectRepoCredential(
  userId: string,
  projectId: string,
  provider: GitProvider,
  baseUrl?: string,
) {
  const conds = [
    eq(userProjectRepoCredentials.userId, userId),
    eq(userProjectRepoCredentials.projectId, projectId),
    eq(userProjectRepoCredentials.provider, provider),
    eq(userProjectRepoCredentials.isActive, 1),
  ];
  if (baseUrl) {
    conds.push(eq(userProjectRepoCredentials.baseUrl, normalizeProviderBaseUrl(provider, baseUrl)));
  }

  const [cred] = await db
    .select()
    .from(userProjectRepoCredentials)
    .where(and(...conds))
    .limit(1);
  return cred ?? null;
}

export async function saveUserGitCredential(
  userId: string,
  data: { provider: GitProvider; baseUrl?: string; token: string }
) {
  const spec = PROVIDERS[data.provider];
  const baseUrl = normalizeProviderBaseUrl(data.provider, data.baseUrl?.trim() || spec.defaultBaseUrl);
  const encrypted = encryptPAT(data.token);
  if (!encrypted) {
    throw new Error('Failed to encrypt Git token. Check PAT_ENCRYPTION_KEY configuration.');
  }

  const existing = await db
    .select()
    .from(userGitCredentials)
    .where(and(
      eq(userGitCredentials.userId, userId),
      eq(userGitCredentials.provider, data.provider),
      eq(userGitCredentials.baseUrl, baseUrl),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userGitCredentials)
      .set({ tokenEncrypted: encrypted, isActive: 1, updatedAt: new Date() })
      .where(eq(userGitCredentials.id, existing[0].id));
    return existing[0].id;
  }

  const id = crypto.randomUUID();
  await db.insert(userGitCredentials).values({
    id,
    userId,
    provider: data.provider,
    baseUrl,
    tokenEncrypted: encrypted,
  });
  return id;
}

export async function saveUserProjectRepoCredential(
  userId: string,
  projectId: string,
  data: { provider: GitProvider; baseUrl?: string; token: string },
) {
  const spec = PROVIDERS[data.provider];
  const baseUrl = normalizeProviderBaseUrl(data.provider, data.baseUrl?.trim() || spec.defaultBaseUrl);
  const encrypted = encryptPAT(data.token);
  if (!encrypted) {
    throw new Error('Failed to encrypt Git token. Check PAT_ENCRYPTION_KEY configuration.');
  }

  const existing = await db
    .select()
    .from(userProjectRepoCredentials)
    .where(and(
      eq(userProjectRepoCredentials.userId, userId),
      eq(userProjectRepoCredentials.projectId, projectId),
      eq(userProjectRepoCredentials.provider, data.provider),
      eq(userProjectRepoCredentials.baseUrl, baseUrl),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userProjectRepoCredentials)
      .set({ tokenEncrypted: encrypted, isActive: 1, updatedAt: new Date() })
      .where(eq(userProjectRepoCredentials.id, existing[0].id));
    return existing[0].id;
  }

  const id = crypto.randomUUID();
  await db.insert(userProjectRepoCredentials).values({
    id,
    userId,
    projectId,
    provider: data.provider,
    baseUrl,
    tokenEncrypted: encrypted,
  });
  return id;
}

export async function deleteUserGitCredential(userId: string, provider: GitProvider, credentialId?: string) {
  const conds = [eq(userGitCredentials.userId, userId), eq(userGitCredentials.provider, provider)];
  if (credentialId) conds.push(eq(userGitCredentials.id, credentialId));
  await db
    .update(userGitCredentials)
    .set({ isActive: 0, updatedAt: new Date() })
    .where(and(...conds));
}

// ── Client resolver ──

export interface GitClient {
  provider: GitProvider;
  baseUrl: string;
  token: string;
}

export async function getGitClientForUser(
  userId: string,
  provider: GitProvider,
  baseUrl?: string,
  projectId?: string,
): Promise<GitClient> {
  const cred = projectId
    ? await getUserProjectRepoCredential(userId, projectId, provider, baseUrl)
    : await getUserGitCredential(userId, provider, baseUrl);
  if (!cred) throw new UserGitCredentialMissingError(provider, userId);

  const token = decryptPAT(cred.tokenEncrypted);
  if (!token || token.trim().length === 0) {
    throw new UserGitCredentialInvalidError(provider, userId, 'token decryption failed or empty');
  }
  return { provider, baseUrl: normalizeProviderBaseUrl(provider, cred.baseUrl), token };
}

async function testGitCredentialRecord(params: {
  userId: string;
  provider: GitProvider;
  credentialId: string;
  baseUrl: string;
  tokenEncrypted: string;
  updateProjectCredential: boolean;
}): Promise<{ externalUserId: string; username: string }> {
  const token = decryptPAT(params.tokenEncrypted);
  if (!token || token.trim().length === 0) {
    throw new UserGitCredentialInvalidError(params.provider, params.userId, 'token decryption failed or empty');
  }

  const spec = PROVIDERS[params.provider];
  const credentialBaseUrl = normalizeProviderBaseUrl(params.provider, params.baseUrl);

  let resp: Response;
  try {
    resp = await fetch(spec.buildUserUrl(credentialBaseUrl), { headers: spec.authHeaders(token) });
  } catch (err) {
    throw new UserGitCredentialInvalidError(params.provider, params.userId, err instanceof Error ? err.message : String(err));
  }

  if (resp.status === 401 || resp.status === 403) {
    if (params.updateProjectCredential) {
      await db
        .update(userProjectRepoCredentials)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(userProjectRepoCredentials.id, params.credentialId));
    } else {
      await db
        .update(userGitCredentials)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(userGitCredentials.id, params.credentialId));
    }
    throw new UserGitCredentialInvalidError(params.provider, params.userId, `${resp.status} Unauthorized`);
  }
  if (!resp.ok) {
    throw new UserGitCredentialInvalidError(params.provider, params.userId, `${params.provider} user endpoint returned ${resp.status}`);
  }

  const payload: any = await resp.json();
  const { externalUserId, username } = spec.parseUser(payload);
  if (params.updateProjectCredential) {
    await db
      .update(userProjectRepoCredentials)
      .set({ externalUserId, username, lastTestedAt: new Date(), updatedAt: new Date() })
      .where(eq(userProjectRepoCredentials.id, params.credentialId));
  } else {
    await db
      .update(userGitCredentials)
      .set({ externalUserId, username, lastTestedAt: new Date(), updatedAt: new Date() })
      .where(eq(userGitCredentials.id, params.credentialId));
  }

  return { externalUserId, username };
}

// ── Test credential ──

export async function testUserGitCredential(userId: string, provider: GitProvider, baseUrl?: string): Promise<{
  externalUserId: string;
  username: string;
}> {
  const cred = await getUserGitCredential(userId, provider, baseUrl);
  if (!cred) throw new UserGitCredentialMissingError(provider, userId);

  return testGitCredentialRecord({
    userId,
    provider,
    credentialId: cred.id,
    baseUrl: cred.baseUrl,
    tokenEncrypted: cred.tokenEncrypted,
    updateProjectCredential: false,
  });
}

export async function testUserProjectRepoCredential(
  userId: string,
  projectId: string,
  provider: GitProvider,
  baseUrl?: string,
): Promise<{ externalUserId: string; username: string }> {
  const cred = await getUserProjectRepoCredential(userId, projectId, provider, baseUrl);
  if (!cred) throw new UserGitCredentialMissingError(provider, userId);

  return testGitCredentialRecord({
    userId,
    provider,
    credentialId: cred.id,
    baseUrl: cred.baseUrl,
    tokenEncrypted: cred.tokenEncrypted,
    updateProjectCredential: true,
  });
}
