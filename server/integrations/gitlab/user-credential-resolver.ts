/**
 * GitLab-specific compatibility shim over the generic per-user Git credential
 * resolver (server/integrations/git/user-credential-resolver.ts).
 *
 * Keeps the original GitLab API surface so existing callers don't change, while
 * all storage/validation lives in the provider-dispatched generic resolver.
 * New providers (GitHub, Bitbucket) should call the generic resolver directly
 * with their provider key rather than adding more shims like this.
 */

import {
  getUserGitCredential,
  saveUserGitCredential,
  deleteUserGitCredential,
  getGitClientForUser,
  testUserGitCredential,
  UserGitCredentialMissingError,
  UserGitCredentialInvalidError,
  type GitClient,
} from '../git/user-credential-resolver';

// Re-export the generic error classes under the historical GitLab names so
// `instanceof` checks in gitlab-repos.ts / user-gitlab.ts keep working. The
// `.code` on a thrown error is provider-specific (GITLAB_PAT_MISSING/INVALID).
export {
  UserGitCredentialMissingError as UserGitlabCredentialMissingError,
  UserGitCredentialInvalidError as UserGitlabCredentialInvalidError,
};

export function getUserGitlabCredential(userId: string, baseUrl?: string) {
  return getUserGitCredential(userId, 'gitlab', baseUrl);
}

export function saveUserGitlabCredential(userId: string, data: { baseUrl?: string; token: string }) {
  return saveUserGitCredential(userId, { provider: 'gitlab', baseUrl: data.baseUrl, token: data.token });
}

export function deleteUserGitlabCredential(userId: string, credentialId?: string) {
  return deleteUserGitCredential(userId, 'gitlab', credentialId);
}

export function getGitlabClientForUser(userId: string, baseUrl?: string): Promise<GitClient> {
  return getGitClientForUser(userId, 'gitlab', baseUrl);
}

export function testUserGitlabCredential(userId: string, baseUrl?: string) {
  return testUserGitCredential(userId, 'gitlab', baseUrl);
}
