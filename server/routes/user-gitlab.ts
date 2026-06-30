import type { Express, Request, Response } from 'express';
import {
  getUserGitlabCredential,
  saveUserGitlabCredential,
  deleteUserGitlabCredential,
  testUserGitlabCredential,
  UserGitlabCredentialMissingError,
  UserGitlabCredentialInvalidError,
} from '../integrations/gitlab/user-credential-resolver';
import { decryptPAT } from '../crypto-utils';

function getUserId(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

function handleCredentialError(res: Response, err: unknown) {
  if (err instanceof UserGitlabCredentialMissingError) {
    return res.status(428).json({ code: err.code, message: err.message });
  }
  if (err instanceof UserGitlabCredentialInvalidError) {
    return res.status(400).json({ code: err.code, message: err.message });
  }
  console.error('[UserGitlab]', err);
  return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
}

export function registerUserGitlabRoutes(app: Express): void {

  // ── GET credential status (never returns raw token) ──
  app.get('/api/user/gitlab-credentials', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const cred = await getUserGitlabCredential(userId);
      if (!cred) return res.json({ connected: false });

      let tokenLast4 = '';
      try {
        const raw = decryptPAT(cred.tokenEncrypted) || '';
        tokenLast4 = raw.length >= 4 ? raw.slice(-4) : '****';
      } catch {
        tokenLast4 = '????';
      }

      return res.json({
        connected: true,
        baseUrl: cred.baseUrl,
        username: cred.username,
        gitlabUserId: cred.externalUserId,
        lastTestedAt: cred.lastTestedAt,
        tokenLast4,
      });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── POST save + test new credential ──
  app.post('/api/user/gitlab-credentials', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { baseUrl, token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'token is required' });
      }

      await saveUserGitlabCredential(userId, { baseUrl, token });
      const user = await testUserGitlabCredential(userId);
      const credential = await getUserGitlabCredential(userId);

      const tokenLast4 = token.length >= 4 ? token.slice(-4) : '****';
      return res.json({
        connected: true,
        baseUrl: credential?.baseUrl || (baseUrl || 'https://gitlab.com').replace(/\/+$/, ''),
        username: user.username,
        gitlabUserId: user.externalUserId,
        lastTestedAt: new Date().toISOString(),
        tokenLast4,
      });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── POST re-test existing credential ──
  app.post('/api/user/gitlab-credentials/test', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const user = await testUserGitlabCredential(userId);
      return res.json({ success: true, username: user.username, gitlabUserId: user.externalUserId });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── DELETE deactivate credential ──
  app.delete('/api/user/gitlab-credentials', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      await deleteUserGitlabCredential(userId);
      return res.json({ connected: false });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });
}
