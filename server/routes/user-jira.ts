import type { Express, Request, Response } from 'express';
import {
  getUserJiraCredential,
  saveUserJiraCredential,
  deleteUserJiraCredential,
  getJiraServiceForUser,
  testUserJiraCredential,
  UserJiraCredentialMissingError,
  UserJiraCredentialInvalidError,
} from '../integrations/jira/user-credential-resolver';
import { db } from '../db';
import { sdlcProjects, jiraActionLogs } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { decrypt } from '../jira-routes';

function getUserId(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

function handleCredentialError(res: Response, err: unknown) {
  if (err instanceof UserJiraCredentialMissingError) {
    return res.status(428).json({ code: err.code, message: err.message });
  }
  if (err instanceof UserJiraCredentialInvalidError) {
    return res.status(400).json({ code: err.code, message: err.message });
  }
  console.error('[UserJira]', err);
  return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
}

export function registerUserJiraRoutes(app: Express): void {

  // ── GET credential status (never returns raw token) ──
  app.get('/api/user/jira-credentials', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const instanceUrl =
        typeof req.query.instanceUrl === "string" && req.query.instanceUrl.trim()
          ? req.query.instanceUrl.trim()
          : undefined;
      const cred = await getUserJiraCredential(userId, instanceUrl);
      if (cred) {
        let tokenLast4 = '';
        try {
          const raw = decrypt(cred.apiTokenEncrypted);
          tokenLast4 = raw.length >= 4 ? raw.slice(-4) : '****';
        } catch {
          tokenLast4 = '????';
        }

        return res.json({
          connected: true,
          source: 'personal',
          instanceUrl: cred.instanceUrl,
          email: cred.email,
          displayName: cred.displayName,
          accountId: cred.accountId,
          lastTestedAt: cred.lastTestedAt,
          tokenLast4,
        });
      }

      // No personal credential — every user must connect their own Jira PAT.
      // There is intentionally no shared/org-level connection fallback.
      return res.json({ connected: false });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── POST save + test new credential ──
  app.post('/api/user/jira-credentials', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { instanceUrl, email, apiToken } = req.body;
      if (!instanceUrl || !email || !apiToken) {
        return res.status(400).json({ error: 'instanceUrl, email, and apiToken are required' });
      }

      const normalizedInstanceUrl = instanceUrl.replace(/\/+$/, '');
      await saveUserJiraCredential(userId, { instanceUrl: normalizedInstanceUrl, email, apiToken });

      const user = await testUserJiraCredential(userId, normalizedInstanceUrl);

      const tokenLast4 = apiToken.length >= 4 ? apiToken.slice(-4) : '****';
      return res.json({
        connected: true,
        instanceUrl: normalizedInstanceUrl,
        email,
        displayName: user.displayName,
        accountId: user.accountId,
        lastTestedAt: new Date().toISOString(),
        tokenLast4,
      });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── POST re-test existing credential ──
  app.post('/api/user/jira-credentials/test', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const instanceUrl =
        typeof req.body?.instanceUrl === "string" && req.body.instanceUrl.trim()
          ? req.body.instanceUrl.trim()
          : undefined;
      const user = await testUserJiraCredential(userId, instanceUrl);
      return res.json({ success: true, displayName: user.displayName, accountId: user.accountId });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── DELETE deactivate credential ──
  app.delete('/api/user/jira-credentials', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      await deleteUserJiraCredential(userId);
      return res.json({ connected: false });
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── GET user's Jira projects (live API call with user's PAT) ──
  app.get('/api/user/jira-projects', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const jiraService = await getJiraServiceForUser(userId);
      const projects = await jiraService.getProjects();

      const sdlcRows = await db
        .select()
        .from(sdlcProjects)
        .where(eq(sdlcProjects.integrationType, 'jira'));

      const sdlcMap = new Map<string, typeof sdlcRows[0]>();
      for (const row of sdlcRows) {
        if (row.jiraProjectKey) {
          sdlcMap.set(row.jiraProjectKey, row);
        }
      }

      const result = projects.map((p) => ({
        ...p,
        sdlcProject: sdlcMap.get(p.key) ?? null,
      }));

      return res.json(result);
    } catch (err) {
      return handleCredentialError(res, err);
    }
  });

  // ── POST create new Jira project ──
  // Every user acts with their own PAT. Jira project creation requires the
  // global "Administer Jira" permission, so the acting user's own token must
  // have it; otherwise we surface a clear 403. The clicker becomes the project
  // lead. There is no shared/admin connection fallback.
  app.post('/api/user/jira-projects', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { name, key, description, template } = req.body;
      if (!name || !key) {
        return res.status(400).json({ error: 'name and key are required' });
      }

      // Resolve the target instance from the user's personal credential.
      const cred = await getUserJiraCredential(userId);
      const instanceUrl = cred?.instanceUrl;
      if (!instanceUrl) {
        return res.status(428).json({
          code: 'JIRA_PAT_MISSING',
          error: 'No Jira instance configured for this user',
          message:
            'Connect your Jira account on the Connect Jira page so we know which instance to target.',
        });
      }

      // Use the acting user's own Jira credential for creation.
      const userJira = await getJiraServiceForUser(userId, undefined, instanceUrl);

      // Resolve clicker's accountId so they become the project lead.
      let leadAccountId: string | undefined;
      try {
        const me = await userJira.getCurrentUser();
        leadAccountId = me?.accountId ?? undefined;
      } catch {
        // Fall through; Jira will default the lead if we can't resolve the clicker.
      }

      const project = await userJira.createProject({
        name,
        key: key.toUpperCase(),
        description,
        projectTemplateKey: template,
        leadAccountId,
      });

      const sdlcId = crypto.randomUUID();
      await db.insert(sdlcProjects).values({
        id: sdlcId,
        name,
        projectId: project.key,
        integrationType: 'jira',
        jiraProjectKey: project.key,
        jiraInstanceUrl: instanceUrl,
        jiraConnectionId: null,
        ownerUserId: userId,
        status: 'active',
      });

      return res.json({ sdlcProjectId: sdlcId, jiraProject: project });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/403/.test(msg) && /administrator/i.test(msg)) {
        return res.status(403).json({
          error: 'Jira admin permission required',
          message:
            "Your Jira account lacks the global 'Administer Jira' permission required to create a project. " +
            "Ask a Jira site admin to grant it to your account, then try again.",
        });
      }
      return handleCredentialError(res, err);
    }
  });

  // ── GET jira activity log for a project ──
  app.get('/api/projects/:projectId/jira-activity', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const logs = await db
        .select()
        .from(jiraActionLogs)
        .where(eq(jiraActionLogs.sdlcProjectId, projectId))
        .orderBy(desc(jiraActionLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return res.json({ logs, limit, offset });
    } catch (err) {
      console.error('[JiraActivity]', err);
      return res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
  });
}
