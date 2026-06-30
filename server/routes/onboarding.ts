import type { Express, Request, Response } from 'express';
import { db } from '../db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  testUserJiraCredential,
  UserJiraCredentialMissingError,
  UserJiraCredentialInvalidError,
} from '../integrations/jira/user-credential-resolver';
import {
  testUserGitlabCredential,
  UserGitlabCredentialMissingError,
  UserGitlabCredentialInvalidError,
} from '../integrations/gitlab/user-credential-resolver';

function getUserId(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

export function registerOnboardingRoutes(app: Express): void {
  // ── POST complete onboarding ──
  // Single source of truth for flipping users.onboarding_completed. Re-validates
  // BOTH the user's JIRA and GitLab PATs before marking onboarding complete.
  app.post('/api/user/complete-onboarding', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // 1. JIRA must be connected + valid.
    try {
      await testUserJiraCredential(userId);
    } catch (err) {
      if (err instanceof UserJiraCredentialMissingError) {
        return res.status(428).json({ code: err.code, provider: 'jira', message: err.message });
      }
      if (err instanceof UserJiraCredentialInvalidError) {
        return res.status(401).json({ code: err.code, provider: 'jira', message: err.message });
      }
      console.error('[Onboarding] Jira validation error:', err);
      return res.status(502).json({ provider: 'jira', error: 'Failed to validate Jira credential' });
    }

    // 2. GitLab must be connected + valid.
    try {
      await testUserGitlabCredential(userId);
    } catch (err) {
      if (err instanceof UserGitlabCredentialMissingError) {
        return res.status(428).json({ code: err.code, provider: 'gitlab', message: err.message });
      }
      if (err instanceof UserGitlabCredentialInvalidError) {
        return res.status(401).json({ code: err.code, provider: 'gitlab', message: err.message });
      }
      console.error('[Onboarding] GitLab validation error:', err);
      return res.status(502).json({ provider: 'gitlab', error: 'Failed to validate GitLab credential' });
    }

    // 3. Both valid → mark onboarded.
    await db
      .update(users)
      .set({ onboardingCompleted: true, onboardingCompletedAt: new Date() })
      .where(eq(users.id, userId));

    return res.json({ onboardingCompleted: true });
  });
}
