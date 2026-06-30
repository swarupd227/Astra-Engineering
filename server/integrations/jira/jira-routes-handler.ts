/**
 * Jira Routes Handler
 * Handles Jira-specific API routes for SDLC projects
 * Modular structure - separate from main routes.ts
 */

import { Request, Response } from 'express';
import { db } from '../../db';
import * as schema from '@shared/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { JiraService } from './jira-service';
import { JiraPushService } from './jira-push-service';
import { ConfluenceService } from './confluence-service';
import { JiraBacklogService } from './jira-backlog-service';
import { JiraDesignService } from './jira-design-service';
import { asyncJobManager } from '../../lib/async-job-manager';
import { JiraDevelopmentService } from './jira-development-service';
import { JiraBuildService } from './jira-build-service';
import { sdlcService } from '../../sdlc/service';
import type { Persona } from '@shared/schema';
import crypto from 'crypto';
import { getJiraServiceForUser, UserJiraCredentialMissingError, UserJiraCredentialInvalidError } from './user-credential-resolver';
import { decrypt as decryptJiraToken } from '../../jira-routes';

export function isUserJiraCredentialError(error: unknown): boolean {
  return error instanceof UserJiraCredentialMissingError || error instanceof UserJiraCredentialInvalidError;
}

export function userJiraCredentialHttpStatus(error: unknown): number {
  if (error instanceof UserJiraCredentialMissingError) return 428;
  if (error instanceof UserJiraCredentialInvalidError) return 401;
  return 500;
}

export function userJiraCredentialMessage(error: unknown): string {
  if (error instanceof UserJiraCredentialMissingError) {
    return "Configure and validate your personal Jira API key before accessing this Jira project.";
  }
  if (error instanceof UserJiraCredentialInvalidError) {
    return "Your personal Jira API key is invalid or expired. Update and validate it before accessing this Jira project.";
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Get JiraService for an operation that touches Jira project data.
 * Every user must authenticate Jira with their own API key; there is no
 * shared/org-level fallback for user-facing reads or writes.
 */
export async function getJiraServiceForWrite(req: Request, projectKey?: string, instanceUrl?: string): Promise<JiraService> {
  const userId = (req as any).user?.id;
  if (!userId) {
    throw new UserJiraCredentialMissingError("anonymous");
  }
  return await getJiraServiceForUser(userId, projectKey, instanceUrl);
}

/**
 * Get Jira configuration for a project
 */
export async function getJiraConfig(projectId: string): Promise<{
  instanceUrl: string;
  projectKey: string;
  email: string;
  apiToken: string;
  spaceKey?: string;
} | null> {
  try {
    // Get project
    const project = await db
      .select()
      .from(schema.sdlcProjects)
      .where(eq(schema.sdlcProjects.id, projectId))
      .limit(1);

    if (project.length === 0) {
      console.warn(`[getJiraConfig] Project not found: ${projectId}`);
      return null;
    }
    if (project[0].integrationType !== 'jira') {
      console.warn(`[getJiraConfig] Project ${projectId} has integrationType="${project[0].integrationType}", expected "jira"`);
      return null;
    }

    const sdlcProject = project[0];

    // Get Jira settings for this project
    const jiraSettings = await db
      .select()
      .from(schema.jiraSettings)
      .where(eq(schema.jiraSettings.projectId, projectId))
      .limit(1);

    if (jiraSettings.length === 0) {
      console.log(`[getJiraConfig] No jira_settings row for project ${projectId}, trying jira_connections fallback`);
      // Try to get from connection
      if (sdlcProject.jiraConnectionId) {
        let connection = await db
          .select()
          .from(schema.jiraConnections)
          .where(eq(schema.jiraConnections.id, sdlcProject.jiraConnectionId))
          .limit(1);

        // Fallback: if referenced connection doesn't exist, try to find one by instance URL
        if (connection.length === 0 && sdlcProject.jiraInstanceUrl) {
          console.warn(`[getJiraConfig] Connection ${sdlcProject.jiraConnectionId} not found, searching by instance URL: ${sdlcProject.jiraInstanceUrl}`);
          const cleanUrl = sdlcProject.jiraInstanceUrl.replace(/\/+$/, '').toLowerCase();
          connection = await db
            .select()
            .from(schema.jiraConnections)
            .where(sql`LOWER(TRIM(TRAILING '/' FROM ${schema.jiraConnections.instanceUrl})) = ${cleanUrl}`)
            .limit(1);
          if (connection.length > 0) {
            console.log(`[getJiraConfig] Found fallback connection ${connection[0].id} for ${cleanUrl}, self-healing jiraConnectionId`);
            await db.update(schema.sdlcProjects)
              .set({ jiraConnectionId: connection[0].id })
              .where(eq(schema.sdlcProjects.id, projectId));
          }
        }

        if (connection.length > 0) {
          // Decrypt API token
          let decryptedToken: string;
          try {
            decryptedToken = decryptJiraToken(connection[0].apiTokenEncrypted);
            if (!decryptedToken || decryptedToken.trim().length === 0) {
              console.error('[JiraRoutesHandler] Failed to decrypt API token from connection');
              return null;
            }
          } catch (decryptError) {
            console.error('[JiraRoutesHandler] Error decrypting API token from connection:', decryptError);
            return null;
          }

          // Get projectKey from sdlcProject or settings
          let projectKey = sdlcProject.jiraProjectKey || '';
          
          console.log('[JiraRoutesHandler] Retrieved projectKey from connection path:', {
            projectId,
            jiraProjectKey: sdlcProject.jiraProjectKey,
            finalProjectKey: projectKey,
          });
          
          if (!projectKey || projectKey.trim() === '') {
            console.error('[JiraRoutesHandler] projectKey is missing from sdlcProject:', {
              projectId,
              jiraProjectKey: sdlcProject.jiraProjectKey,
            });
            return null;
          }
          
          // Trim and validate project key
          projectKey = projectKey.trim();

          console.log(`[getJiraConfig] CREDENTIALS CHECK (connection path): email="${connection[0].email}", token="${decryptedToken.slice(0, 4)}...${decryptedToken.slice(-4)}" (${decryptedToken.length} chars), projectKey="${projectKey}", instanceUrl="${connection[0].instanceUrl}"`);
          return {
            instanceUrl: connection[0].instanceUrl,
            projectKey: projectKey,
            email: connection[0].email,
            apiToken: decryptedToken,
            spaceKey: projectKey,
          };
        }
      } else if (sdlcProject.jiraInstanceUrl) {
        console.warn(`[getJiraConfig] No jiraConnectionId on project ${projectId}, trying URL-based lookup: ${sdlcProject.jiraInstanceUrl}`);
        const cleanUrl = sdlcProject.jiraInstanceUrl.replace(/\/+$/, '').toLowerCase();
        const connection = await db
          .select()
          .from(schema.jiraConnections)
          .where(sql`LOWER(TRIM(TRAILING '/' FROM ${schema.jiraConnections.instanceUrl})) = ${cleanUrl}`)
          .limit(1);

        if (connection.length > 0) {
          console.log(`[getJiraConfig] Found connection ${connection[0].id} by URL for project ${projectId}`);
          await db.update(schema.sdlcProjects)
            .set({ jiraConnectionId: connection[0].id })
            .where(eq(schema.sdlcProjects.id, projectId));

          let decryptedToken: string;
          try {
            decryptedToken = decryptJiraToken(connection[0].apiTokenEncrypted);
            if (!decryptedToken || decryptedToken.trim().length === 0) {
              console.error('[getJiraConfig] Failed to decrypt API token from URL-based connection');
              return null;
            }
          } catch (decryptError) {
            console.error('[getJiraConfig] Error decrypting token from URL-based connection:', decryptError);
            return null;
          }

          const projectKey = (sdlcProject.jiraProjectKey || '').trim();
          if (!projectKey) {
            console.error(`[getJiraConfig] No projectKey for project ${projectId}`);
            return null;
          }

          return {
            instanceUrl: connection[0].instanceUrl,
            projectKey,
            email: connection[0].email,
            apiToken: decryptedToken,
            spaceKey: projectKey,
          };
        }
        console.warn(`[getJiraConfig] No connection found by URL either`);
      } else {
        console.warn(`[getJiraConfig] No jiraConnectionId and no jiraInstanceUrl on project ${projectId}`);
      }
      return null;
    }

    const settings = jiraSettings[0];

    // Get projectKey - prefer from jiraSettings, fallback to sdlcProject
    let projectKey = settings.projectKey || sdlcProject.jiraProjectKey || '';
    
    console.log('[JiraRoutesHandler] Retrieved projectKey:', {
      projectId,
      fromJiraSettings: settings.projectKey,
      fromSdlcProject: sdlcProject.jiraProjectKey,
      finalProjectKey: projectKey,
    });
    
    if (!projectKey || projectKey.trim() === '') {
      console.error('[JiraRoutesHandler] projectKey is missing from both jiraSettings and sdlcProject:', {
        projectId,
        jiraSettingsProjectKey: settings.projectKey,
        sdlcProjectJiraProjectKey: sdlcProject.jiraProjectKey,
      });
      return null;
    }
    
    // Trim and validate project key
    projectKey = projectKey.trim();

    // Resolve email + API token.
    //
    // CRITICAL: when both a settings row and a linked connection exist, prefer
    // the connection's credentials. The per-project `jira_settings` token is
    // a legacy/manual override — in practice it tends to go stale (e.g. an old
    // API token that has since been revoked or scoped down) while the
    // org-level `jira_connections` token gets refreshed whenever the user
    // updates the connection in Settings / Admin. The previous code did the
    // opposite (settings token first) and led to the "200 OK on /search/jql
    // but 0 issues + 0 fields" symptom when the settings token was effectively
    // unauthorised on most projects.
    let email: string | null = settings.email;
    let apiToken: string = '';
    let connectionInstanceUrl: string | null = null;
    let credentialSource: 'connection' | 'settings' = 'settings';

    const tryDecrypt = (cipherText: string | null | undefined): string | null => {
      if (!cipherText) return null;
      try {
        const out = decryptJiraToken(cipherText);
        return out && out.trim().length > 0 ? out : null;
      } catch (err) {
        console.warn(
          `[JiraRoutesHandler] Token decrypt failed: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      }
    };

    if (settings.connectionId) {
      const connection = await db
        .select()
        .from(schema.jiraConnections)
        .where(eq(schema.jiraConnections.id, settings.connectionId))
        .limit(1);

      if (connection.length > 0) {
        connectionInstanceUrl = connection[0].instanceUrl;
        const connToken = tryDecrypt(connection[0].apiTokenEncrypted);
        if (connToken) {
          email = connection[0].email || email;
          apiToken = connToken;
          credentialSource = 'connection';
        } else {
          console.warn(
            `[JiraRoutesHandler] Connection ${settings.connectionId} has no usable token; falling back to per-project settings token`,
          );
        }
      } else {
        console.warn(
          `[JiraRoutesHandler] connectionId ${settings.connectionId} on jira_settings does not match any jira_connections row`,
        );
      }
    }

    // Fall back to the per-project settings token only if the connection
    // didn't provide a usable one.
    if (!apiToken) {
      const settingsToken = tryDecrypt(settings.apiTokenEncrypted);
      if (settingsToken) {
        apiToken = settingsToken;
        credentialSource = 'settings';
      }
    }

    if (!apiToken) {
      console.error(
        `[JiraRoutesHandler] No usable Jira API token for project ${projectId} (settings.connectionId=${settings.connectionId || 'none'})`,
      );
      return null;
    }

    if (!email) {
      console.error(
        `[JiraRoutesHandler] No usable email for project ${projectId} — cannot build Basic auth header`,
      );
      return null;
    }

    // Resolve the final instance URL. When the connection's URL differs from
    // the stored settings URL, prefer the connection's URL (it matches the
    // token). This protects against stale/wrong settings.instanceUrl after a
    // connection rename or re-point.
    const normalize = (u: string | null | undefined) =>
      (u || '').trim().replace(/\/+$/, '').toLowerCase();
    let finalInstanceUrl = settings.instanceUrl;
    if (
      connectionInstanceUrl &&
      normalize(connectionInstanceUrl) !== normalize(settings.instanceUrl)
    ) {
      console.warn(
        `[getJiraConfig] instanceUrl mismatch for project ${projectId}: settings="${settings.instanceUrl}" vs connection="${connectionInstanceUrl}". Using connection URL since the token belongs to that connection.`,
      );
      finalInstanceUrl = connectionInstanceUrl;
    }

    console.log(
      `[getJiraConfig] CREDENTIALS CHECK (settings path, source=${credentialSource}): email="${email}", token="${apiToken.slice(0, 4)}...${apiToken.slice(-4)}" (${apiToken.length} chars), projectKey="${projectKey}", instanceUrl="${finalInstanceUrl}"`,
    );
    return {
      instanceUrl: finalInstanceUrl,
      projectKey: projectKey,
      email: email,
      apiToken: apiToken,
      spaceKey: settings.confluenceSpaceKey || projectKey,
    };
  } catch (error) {
    console.error('[JiraRoutesHandler] Error getting Jira config:', error);
    return null;
  }
}

/**
 * Push work items to Jira
 * POST /api/sdlc/projects/:projectId/push-to-jira
 */
export async function handlePushToJira(req: Request, res: Response) {
  try {
    const { projectId } = req.params;
    const { epics, features, userStories, selectedItems: uiSelectedItems, phaseNumber, artifactId, config, brdId, requirementIds } = req.body;

    if (!epics || !features || !userStories) {
      return res.status(400).json({ error: "Epics, features, and user stories are required" });
    }

    // Get project to check integration type
    const project = await db
      .select()
      .from(schema.sdlcProjects)
      .where(eq(schema.sdlcProjects.id, projectId))
      .limit(1);

    if (project.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project[0].integrationType !== 'jira') {
      return res.status(400).json({ 
        error: "This project is not configured for Jira integration. Please use push-to-ado endpoint for ADO projects." 
      });
    }

    // Fetch BRD ID and requirement IDs (similar to ADO endpoint)
    let effectiveBrdId: string | null = brdId || null;
    let effectiveRequirementIds: string[] = requirementIds || [];
    let effectiveArtifactId: string | null = artifactId || null;

    if (!effectiveArtifactId && (userStories?.length > 0 || epics?.length > 0 || features?.length > 0)) {
      try {
        const workflowArtifacts = await db
          .select({
            id: schema.workflowArtifacts.id,
            epics: schema.workflowArtifacts.epics,
            features: schema.workflowArtifacts.features,
            userStories: schema.workflowArtifacts.userStories,
          })
          .from(schema.workflowArtifacts)
          .where(eq(schema.workflowArtifacts.projectId, projectId))
          .orderBy(sql`${schema.workflowArtifacts.createdAt} DESC`)
          .limit(10);

        for (const artifact of workflowArtifacts) {
          const artifactEpics = (artifact.epics as any[]) || [];
          const artifactFeatures = (artifact.features as any[]) || [];
          const artifactStories = (artifact.userStories as any[]) || [];

          const hasMatchingEpic = epics.some((e: any) => artifactEpics.some((ae: any) => ae.id === e.id));
          const hasMatchingFeature = features.some((f: any) => artifactFeatures.some((af: any) => af.id === f.id));
          const hasMatchingStory = userStories.some((s: any) => artifactStories.some((as: any) => as.id === s.id));

          if (hasMatchingEpic || hasMatchingFeature || hasMatchingStory) {
            effectiveArtifactId = artifact.id;
            break;
          }
        }
      } catch (lookupError) {
        console.warn("[Push to Jira] Failed to lookup workflow artifact ID:", lookupError);
      }
    }

    if (effectiveArtifactId) {
      try {
        const requirementRows = await db
          .select({
            id: schema.devBrdRequirements.id,
            brdId: schema.devBrdRequirements.brdId,
          })
          .from(schema.devBrdRequirements)
          .where(eq(schema.devBrdRequirements.workflowId, effectiveArtifactId));

        if (requirementRows.length > 0) {
          effectiveBrdId = requirementRows[0].brdId;
          effectiveRequirementIds = requirementRows.map((row) => row.id);
        }
      } catch (traceError) {
        console.warn("[Push to Jira] Failed to fetch BRD / requirement IDs:", traceError);
      }
    }

    // Get Jira config from database first
    let jiraConfig = await getJiraConfig(projectId);

    // Allow override from request config (but only if it has all required fields AND valid projectKey)
    if (config && config.instanceUrl && config.projectKey && config.email && config.apiToken) {
      // Validate the projectKey from request config
      const requestProjectKey = (config.projectKey || '').trim();
      if (requestProjectKey && requestProjectKey !== 'undefined') {
        jiraConfig = {
          instanceUrl: config.instanceUrl,
          projectKey: requestProjectKey,
          email: config.email,
          apiToken: config.apiToken,
          spaceKey: config.spaceKey || requestProjectKey,
        };
        console.log('[Push to Jira] Using projectKey from request config:', requestProjectKey);
      } else {
        console.warn('[Push to Jira] Request config has invalid projectKey, using database config instead');
      }
    }

    if (!jiraConfig) {
      console.error(`[Push to Jira] getJiraConfig returned null for project ${projectId}. Check logs above for specific reason.`);
      return res.status(400).json({
        error: "Jira configuration is required. No jira_settings row found and the Jira connection could not be resolved. Please re-create the project from Organizations or configure in Settings."
      });
    }

    // Validate that projectKey is set and valid
    const projectKey = (jiraConfig.projectKey || '').trim();
    if (!projectKey || projectKey === 'undefined') {
      console.error('[Push to Jira] Invalid projectKey:', jiraConfig.projectKey);
      return res.status(400).json({
        error: "Jira project key is missing or invalid. Please configure the project key in Settings."
      });
    }
    
    // Ensure projectKey is set correctly
    jiraConfig.projectKey = projectKey;

    console.log('[Push to Jira] Using config:', {
      instanceUrl: jiraConfig.instanceUrl,
      projectKey: jiraConfig.projectKey,
      email: jiraConfig.email ? '***' : 'MISSING',
      apiToken: jiraConfig.apiToken ? '***' : 'MISSING',
    });

    // Fetch personas
    let personas: Persona[] = [];
    try {
      if (effectiveArtifactId) {
        const artifacts = await db
          .select()
          .from(schema.workflowArtifacts)
          .where(eq(schema.workflowArtifacts.id, effectiveArtifactId))
          .limit(1);

        if (artifacts.length > 0 && artifacts[0].personas) {
          personas = artifacts[0].personas as Persona[];
        }
      }

      if (personas.length === 0 && projectId) {
        const artifacts = await db
          .select()
          .from(schema.workflowArtifacts)
          .where(eq(schema.workflowArtifacts.projectId, projectId))
          .orderBy(sql`${schema.workflowArtifacts.createdAt} DESC`)
          .limit(1);

        if (artifacts.length > 0 && artifacts[0].personas) {
          personas = artifacts[0].personas as Persona[];
        }
      }
    } catch (error) {
      console.warn("[Push to Jira] Warning: Failed to fetch personas:", error);
    }

    // Enrichment: the push service handles duplicate detection via JQL search,
    // so explicit DB enrichment of jiraIssueId is not needed here.

    // Build selected items array
    const selectedItems = (uiSelectedItems && Array.isArray(uiSelectedItems) && uiSelectedItems.length > 0)
      ? uiSelectedItems
      : [
          ...(epics || []).map((e: any) => ({ type: "epic", id: e.id })),
          ...(features || []).map((f: any) => ({ type: "feature", id: f.id })),
          ...(userStories || []).map((s: any) => ({ type: "story", id: s.id })),
        ];

    if (selectedItems.length === 0) {
      return res.status(400).json({ error: "No items to push" });
    }

    const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
    const pushService = new JiraPushService(jiraService);

    const authUser = (req as any).user;
    console.log(`[Push to Jira] Authenticated user: ${authUser ? JSON.stringify({ email: authUser.email, displayName: authUser.displayName }) : 'NOT SET (req.user is undefined)'}`);
    const pushedBy = authUser?.email
      ? { email: authUser.email, displayName: authUser.displayName }
      : undefined;

    // ASYNC-JOB PATTERN: Bulk pushes to Jira (epics + features + stories
    // + sub-tasks + test cases) easily exceed AWS API Gateway's 29s timeout
    // and surface as 503 Service Unavailable. Run the actual push in the
    // background and have the client poll
    // `GET /api/jobs/sdlc-push-to-jira/status/:jobId`.
    const totalSelected = selectedItems.length;
    const { jobId } = asyncJobManager.start(
      "sdlc-push-to-jira",
      async ({ updateProgress }) => {
        updateProgress(10, `Pushing ${totalSelected} item(s) to Jira`);

        const result = await pushService.pushWorkItems(
          selectedItems,
          epics,
          features,
          userStories,
          personas,
          {
            createSubtasks: true,
            skipDuplicateCheck: false,
            brdId: effectiveBrdId,
            requirementIds: effectiveRequirementIds,
            pushedBy,
            onProgress: (percent, message) => updateProgress(percent, message),
          }
        );

        updateProgress(80, "Updating database with Jira IDs");

        // Update database with Jira issue IDs
        try {
          for (const item of result.createdItems) {
            const itemType = String(item.type || '').toLowerCase();
            if (itemType === 'epic') {
              const epic = epics.find((e: any) => e.id === item.id);
              if (epic) {
                await db
                  .update(schema.sdlcEpics)
                  .set({ jiraIssueId: item.jiraIssueId, jiraPushedAt: new Date() })
                  .where(eq(schema.sdlcEpics.id, item.id));
              }
            } else if (itemType === 'feature') {
              const feature = features.find((f: any) => f.id === item.id);
              if (feature) {
                await db
                  .update(schema.sdlcFeatures)
                  .set({ jiraIssueId: item.jiraIssueId, jiraPushedAt: new Date() })
                  .where(eq(schema.sdlcFeatures.id, item.id));
              }
            } else if (itemType === 'story' || itemType === 'user story' || itemType === 'user-story') {
              const story = userStories.find((s: any) => s.id === item.id);
              if (story) {
                await db
                  .update(schema.sdlcBacklogItems)
                  .set({ jiraIssueId: item.jiraIssueId, jiraPushedAt: new Date() })
                  .where(eq(schema.sdlcBacklogItems.id, item.id));
              }
            }
          }

          for (const item of result.skippedItems) {
            const itemType = String(item.type || '').toLowerCase();
            if (itemType === 'epic') {
              await db
                .update(schema.sdlcEpics)
                .set({ jiraIssueId: item.jiraIssueId, jiraSyncedAt: new Date() })
                .where(eq(schema.sdlcEpics.id, item.id));
            } else if (itemType === 'feature') {
              await db
                .update(schema.sdlcFeatures)
                .set({ jiraIssueId: item.jiraIssueId, jiraSyncedAt: new Date() })
                .where(eq(schema.sdlcFeatures.id, item.id));
            } else if (itemType === 'story' || itemType === 'user story' || itemType === 'user-story') {
              await db
                .update(schema.sdlcBacklogItems)
                .set({ jiraIssueId: item.jiraIssueId, jiraSyncedAt: new Date() })
                .where(eq(schema.sdlcBacklogItems.id, item.id));
            }
          }
        } catch (updateError) {
          console.error("[Push to Jira] Error updating database:", updateError);
          // Non-fatal: items are already in Jira. Surface as warning only.
        }

        const totalProcessed = result.createdItems.length + result.skippedItems.length + result.failedItems.length;
        const success = result.createdItems.length > 0 || result.skippedItems.length > 0 || result.failedItems.length === 0;
        const messageParts: string[] = [];
        if (result.createdItems.length > 0) messageParts.push(`${result.createdItems.length} created`);
        if (result.skippedItems.length > 0) messageParts.push(`${result.skippedItems.length} already existed`);
        if (result.failedItems.length > 0) messageParts.push(`${result.failedItems.length} failed`);
        const message = `Pushed to Jira: ${messageParts.join(', ')} (${totalProcessed} total)`;

        return {
          success,
          message,
          created: result.createdItems.length,
          skipped: result.skippedItems.length,
          failed: result.failedItems.length,
          createdItems: result.createdItems,
          skippedItems: result.skippedItems,
          failedItems: result.failedItems,
          errors: result.errors,
          subtasksCreated: result.subtasksCreated,
          testCasesCreated: result.testCasesCreated,
          url: result.url,
          browseUrls: result.browseUrls,
          jiraInstanceUrl: jiraConfig.instanceUrl,
          jiraProjectKey: jiraConfig.projectKey,
          pushedWithEmail: (jiraService as any).config?.email || jiraConfig.email,
        };
      },
      `Pushing ${totalSelected} item(s) to Jira`,
    );

    res.status(202).json({
      success: true,
      jobId,
      status: "processing",
      message: `Push to Jira started. Poll /api/jobs/sdlc-push-to-jira/status/${jobId} for status.`,
    });
  } catch (error: any) {
    console.error("[Push to Jira] Error:", error);
    if (isUserJiraCredentialError(error)) {
      return res.status(userJiraCredentialHttpStatus(error)).json({
        error: userJiraCredentialMessage(error),
        details: error.message || String(error),
      });
    }
    res.status(500).json({
      error: error.message || "Failed to push to Jira",
      details: error.stack,
    });
  }
}

/**
 * Get backlog context from Jira
 * GET /api/sdlc/projects/:projectId/jira/backlog-context
 */
export async function handleGetJiraBacklogContext(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    console.log('[handleGetJiraBacklogContext] Starting for projectId:', projectId);

    // Get Jira config
    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      console.error('[handleGetJiraBacklogContext] No Jira config found for projectId:', projectId);
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    console.log('[handleGetJiraBacklogContext] Jira config retrieved:', {
      instanceUrl: jiraConfig.instanceUrl,
      projectKey: jiraConfig.projectKey,
      email: jiraConfig.email ? '***' : 'MISSING',
      hasApiToken: !!jiraConfig.apiToken,
    });

    const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
    
    // Get backlog context (this already processes everything)
    console.log('[handleGetJiraBacklogContext] Calling getBacklogContext...');
    const backlogContext = await jiraService.getBacklogContext();
    console.log('[handleGetJiraBacklogContext] getBacklogContext completed:', {
      stateCountsKeys: Object.keys(backlogContext.stateCounts || {}),
      stateCountsCount: Object.keys(backlogContext.stateCounts || {}).length,
      developerAssignmentsCount: backlogContext.developerAssignments?.length || 0,
      hasRawEpics: !!(backlogContext as any)._rawEpics,
      hasRawFeatures: !!(backlogContext as any)._rawFeatures,
      hasRawStories: !!(backlogContext as any)._rawStories,
    });

    // Use raw issues from getBacklogContext if available, otherwise fetch separately
    let epics: any[] = [];
    let features: any[] = [];
    let stories: any[] = [];

    if ((backlogContext as any)._rawEpics && (backlogContext as any)._rawFeatures && (backlogContext as any)._rawStories) {
      // Reuse the data from getBacklogContext - it already has full issue details
      console.log('[handleGetJiraBacklogContext] Using raw issues from getBacklogContext');
      const rawEpics = (backlogContext as any)._rawEpics || [];
      const rawFeatures = (backlogContext as any)._rawFeatures || [];
      const rawStories = (backlogContext as any)._rawStories || [];

      // Convert raw Jira issues to WorkItems
      const fieldMapping = await jiraService.getFieldMapping();
      const { mapJiraIssueToWorkItem } = await import('./jira-mappers');

      epics = rawEpics
        .filter((issue: any) => issue && issue.fields)
        .map((issue: any) => mapJiraIssueToWorkItem(issue, fieldMapping));

      features = rawFeatures
        .filter((issue: any) => issue && issue.fields)
        .map((issue: any) => ({
          ...mapJiraIssueToWorkItem(issue, fieldMapping),
          type: 'feature' as const,
          __labels: issue.fields?.labels || [],
          __issueLinks: issue.fields?.issuelinks || [],
        }));

      stories = rawStories
        .filter((issue: any) => issue && issue.fields)
        .map((issue: any) => ({
          ...mapJiraIssueToWorkItem(issue, fieldMapping),
          __labels: issue.fields?.labels || [],
          __issueLinks: issue.fields?.issuelinks || [],
        }));
    } else {
      // Fallback: fetch separately if raw data not available
      console.log('[handleGetJiraBacklogContext] Raw issues not available, fetching separately...');
      [epics, features, stories] = await Promise.all([
        jiraService.getEpics(),
        jiraService.getFeatures(),
        jiraService.getUserStories(),
      ]);
    }

    console.log('[handleGetJiraBacklogContext] Work items for artifactsByState:', {
      epics: epics.length,
      features: features.length,
      stories: stories.length,
      epicSamples: epics.slice(0, 3).map(e => ({ id: e.id, title: e.title, status: e.status })),
      featureSamples: features.slice(0, 3).map(f => ({ id: f.id, title: f.title, status: f.status })),
      storySamples: stories.slice(0, 3).map(s => ({ id: s.id, title: s.title, status: s.status })),
    });

    // Map Jira statuses to ADO-like states (same as in getBacklogContext)
    const statusMapping: Record<string, string> = {
      'To Do': 'New',
      'In Progress': 'Active',
      'Done': 'Closed',
      'In Review': 'Resolved',
      'Blocked': 'Active',
    };

    const normalizeStatus = (status: string): string => {
      return statusMapping[status] || status;
    };

    // Build artifactsByState - group epics, features, and stories by normalized status
    const artifactsByState: Record<string, {
      epics: any[];
      features: any[];
      userStories: any[];
    }> = {};

    // Initialize all states from stateCounts
    Object.keys(backlogContext.stateCounts || {}).forEach(status => {
      artifactsByState[status] = {
        epics: [],
        features: [],
        userStories: [],
      };
    });

    // Group epics by state - convert WorkItem to ADO-like format
    let epicsAdded = 0;
    epics.forEach(epic => {
      const status = normalizeStatus(epic.status || 'Unknown');
      if (!artifactsByState[status]) {
        artifactsByState[status] = { epics: [], features: [], userStories: [] };
      }
      artifactsByState[status].epics.push({
        id: parseInt(epic.id) || epic.id,
        externalId: epic.externalId || '',  // Jira issue key (e.g. PROJ-1)
        rawId: epic.id || '',               // raw numeric string id from Jira
        title: epic.title,
        status: status,
        assignee: epic.assignee,
        storyPoints: epic.storyPoints,
        parentId: epic.parentId ? (parseInt(epic.parentId) || epic.parentId) : undefined,
        fields: {
          'System.Title': epic.title,
          'System.State': status,
        },
        workItemType: 'Epic',
      });
      epicsAdded++;
    });

    // Group features by state
    let featuresAdded = 0;
    features.forEach(feature => {
      const status = normalizeStatus(feature.status || 'Unknown');
      if (!artifactsByState[status]) {
        artifactsByState[status] = { epics: [], features: [], userStories: [] };
      }
      const featureNumericId = parseInt(feature.id) || 0;
      artifactsByState[status].features.push({
        id: featureNumericId || feature.id,
        externalId: feature.externalId || '',  // Jira issue key (e.g. PROJ-5)
        rawId: feature.id || '',               // raw numeric string id from Jira
        title: feature.title,
        status: status,
        assignee: feature.assignee,
        storyPoints: feature.storyPoints,
        parentId: feature.parentId || undefined,
        fields: {
          'System.Title': feature.title,
          'System.State': status,
        },
        labels: Array.isArray((feature as any).__labels) ? (feature as any).__labels : [],
        relations: Array.isArray((feature as any).__issueLinks) ? (feature as any).__issueLinks : [],
        workItemType: 'Feature',
      });
      featuresAdded++;
    });

    // Group stories by state
    let storiesAdded = 0;
    stories.forEach(story => {
      const status = normalizeStatus(story.status || 'Unknown');
      if (!artifactsByState[status]) {
        artifactsByState[status] = { epics: [], features: [], userStories: [] };
      }
      artifactsByState[status].userStories.push({
        id: parseInt(story.id) || story.id,
        externalId: story.externalId || '',  // Jira issue key (e.g. PROJ-10)
        rawId: story.id || '',               // raw numeric string id from Jira
        title: story.title,
        status: status,
        assignee: story.assignee,
        storyPoints: story.storyPoints,
        // Keep parentId as-is: may be a Jira key string (e.g. "PROJ-5") for Jira stories
        parentId: story.parentId || undefined,
        fields: {
          'System.Title': story.title,
          'System.State': status,
        },
        labels: Array.isArray((story as any).__labels) ? (story as any).__labels : [],
        relations: Array.isArray((story as any).__issueLinks) ? (story as any).__issueLinks : [],
        workItemType: 'User Story',
      });
      storiesAdded++;
    });

    console.log('[handleGetJiraBacklogContext] Added to artifactsByState:', {
      epicsAdded,
      featuresAdded,
      storiesAdded,
      totalAdded: epicsAdded + featuresAdded + storiesAdded,
      artifactsByStateKeys: Object.keys(artifactsByState),
      newStateCount: artifactsByState['New'] ? {
        epics: artifactsByState['New'].epics.length,
        features: artifactsByState['New'].features.length,
        userStories: artifactsByState['New'].userStories.length,
        total: artifactsByState['New'].epics.length + artifactsByState['New'].features.length + artifactsByState['New'].userStories.length,
      } : null,
    });

    // The backlogContext already has stateCounts, developerAssignments, and velocity
    // We just need to add availableStates for the frontend
    const allStatuses = new Set<string>();
    Object.keys(backlogContext.stateCounts || {}).forEach(status => {
      allStatuses.add(status);
    });

    // Get available states (sorted)
    const stateOrder = ['New', 'Active', 'In Progress', 'Resolved', 'Closed', 'Removed', 'To Do', 'Testing', 'Done'];
    const availableStates = Array.from(allStatuses)
      .filter((v, i, arr) => arr.indexOf(v) === i) // Remove duplicates
      .sort((a, b) => {
        const aIndex = stateOrder.indexOf(a);
        const bIndex = stateOrder.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
      });

    // Transform developerAssignments to match expected format
    // getBacklogContext returns developerAssignments with 'displayName' field
    const developerAssignments = backlogContext.developerAssignments?.map((dev: any) => ({
      displayName: dev.displayName || dev.developer || 'Unassigned',
      totalStories: dev.totalStories || dev.count || 0,
      storiesByState: dev.storiesByState || {},
      totalStoryPoints: dev.totalStoryPoints || 0,
      completedStoryPoints: dev.completedStoryPoints || 0,
      stories: dev.stories || [],
    })) || [];

    const response = {
      availableStates,
      stateCounts: backlogContext.stateCounts || {},
      artifactsByState,
      developerAssignments,
      velocity: backlogContext.velocity || {
        last7Days: 0,
        last30Days: 0,
        totalStoryPoints: 0,
        completedStoryPoints: 0,
        completionRate: 0,
      },
    };

    console.log('[Jira Backlog Context] Final response stateCounts:', response.stateCounts);
    console.log('[Jira Backlog Context] Response keys:', Object.keys(response.stateCounts));

    res.json(response);
  } catch (error: any) {
    console.error("[Get Jira Backlog Context] Error:", error);
    if (isUserJiraCredentialError(error)) {
      return res.status(userJiraCredentialHttpStatus(error)).json({
        error: userJiraCredentialMessage(error),
        details: error.message || String(error),
      });
    }
    res.status(500).json({
      error: error.message || "Failed to get Jira backlog context",
      details: error.stack,
    });
  }
}

/**
 * Push wiki pages to Confluence
 * POST /api/sdlc/projects/:projectId/push-to-confluence
 */
export async function handlePushToConfluence(req: Request, res: Response) {
  try {
    const { projectId } = req.params;
    const { wikiPages } = req.body;

    if (!wikiPages || !Array.isArray(wikiPages) || wikiPages.length === 0) {
      return res.status(400).json({ error: "Wiki pages are required" });
    }

    // Get Jira config
    const jiraConfig = await getJiraConfig(projectId);

    if (!jiraConfig || !jiraConfig.spaceKey) {
      console.error(`[Push to Confluence] Config missing for project ${projectId}. jiraConfig=${jiraConfig ? 'exists' : 'null'}, spaceKey=${jiraConfig?.spaceKey || 'MISSING'}`);
      return res.status(400).json({
        error: "Jira configuration with Confluence space is required. No jira_settings row found and the Jira connection could not be resolved. Please re-create the project from Organizations or configure in Settings."
      });
    }

    // Initialize Confluence service
    const confluenceService = new ConfluenceService({
      instanceUrl: jiraConfig.instanceUrl,
      email: jiraConfig.email,
      apiToken: jiraConfig.apiToken,
      spaceKey: jiraConfig.spaceKey,
    });

    // Extract user for attribution
    const confluenceUser = (req as any).user;
    console.log(`[Push to Confluence] Authenticated user: ${confluenceUser ? JSON.stringify({ email: confluenceUser.email, displayName: confluenceUser.displayName }) : 'NOT SET (req.user is undefined)'}`);
    const confluencePushedBy = confluenceUser?.email
      ? { email: confluenceUser.email, displayName: confluenceUser.displayName }
      : undefined;

    // ASYNC-JOB PATTERN: Bulk Confluence page creates (one HTTP call per
    // page, plus content conversion) can exceed AWS API Gateway's 29s
    // timeout for large wiki sets. Run the push in the background and have
    // the client poll `GET /api/jobs/sdlc-push-to-confluence/status/:jobId`.
    const pageCount = wikiPages.length;
    const { jobId } = asyncJobManager.start(
      "sdlc-push-to-confluence",
      async ({ updateProgress }) => {
        updateProgress(10, `Pushing ${pageCount} page(s) to Confluence`);
        // NOTE: pushPages signature is (pages, onProgress?) — no pushedBy argument.
        // Previously confluencePushedBy (an object) was incorrectly passed as the
        // onProgress callback, causing "onProgress is not a function" at runtime.
        const result = await confluenceService.pushPages(
          wikiPages,
          (step, percent) => updateProgress(percent, step)
        );
        // pushPages returns { pagesCreated, confluenceUrl, errors, pageUrls, pagesSucceeded, pagesUpdated }
        const pagesCreated = result.pagesCreated ?? 0;
        const pagesUpdated = result.pagesUpdated ?? 0;
        const pagesSucceeded = result.pagesSucceeded ?? pagesCreated;
        const errors = result.errors ?? [];
        updateProgress(
          100,
          `Pushed ${pagesSucceeded} page(s) to Confluence (${pagesCreated} new, ${pagesUpdated} updated)`
        );
        const firstError = errors[0] ? ` First error: ${errors[0]}` : '';
        const message =
          errors.length === 0
            ? `Successfully pushed ${pagesSucceeded} page(s) to Confluence (${pagesCreated} new, ${pagesUpdated} updated)`
            : `Pushed ${pagesSucceeded} of ${pageCount} page(s) (${pagesCreated} new, ${pagesUpdated} updated). ${errors.length} failed.${firstError}`;
        return {
          success: errors.length === 0,
          partialSuccess: pagesSucceeded > 0 && errors.length > 0,
          message,
          pagesCreated,
          pagesUpdated,
          pagesSucceeded,
          succeededWikiIds: result.succeededWikiIds ?? [],
          confluenceUrl: result.confluenceUrl,
          pageUrls: result.pageUrls ?? [],
          errors,
        };
      },
      `Pushing ${pageCount} page(s) to Confluence`,
    );

    res.status(202).json({
      success: true,
      jobId,
      status: "processing",
      message: `Push to Confluence started. Poll /api/jobs/sdlc-push-to-confluence/status/${jobId} for status.`,
    });
  } catch (error: any) {
    console.error("[Push to Confluence] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to push to Confluence",
      details: error.stack,
    });
  }
}

/**
 * Get epics for design phase
 * GET /api/sdlc/projects/:projectId/jira/epics
 */
export async function handleGetJiraEpics(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    const designService = new JiraDesignService(jiraConfig);
    const epics = await designService.getEpics(search);

    res.json(epics);
  } catch (error: any) {
    console.error("[Get Jira Epics] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira epics",
      details: error.stack,
    });
  }
}

/**
 * Get user stories across the project (story-first design flow, no epic).
 * GET /api/sdlc/projects/:projectId/jira/user-stories
 */
export async function handleGetJiraUserStories(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    const designService = new JiraDesignService(jiraConfig);
    const userStories = await designService.getUserStories(search);

    res.json(userStories);
  } catch (error: any) {
    console.error("[Get Jira User Stories] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira user stories",
      details: error.stack,
    });
  }
}

/**
 * Get user stories for a specific epic
 * GET /api/sdlc/projects/:projectId/jira/epics/:epicId/user-stories
 */
export async function handleGetJiraEpicUserStories(req: Request, res: Response) {
  try {
    const { projectId, epicId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const designService = new JiraDesignService(jiraConfig);
    const userStories = await designService.getUserStoriesForEpic(epicId);

    res.json(userStories);
  } catch (error: any) {
    console.error("[Get Jira Epic User Stories] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira epic user stories",
      details: error.stack,
    });
  }
}

/**
 * Get requirements for design phase
 * GET /api/sdlc/projects/:projectId/jira/requirements
 */
export async function handleGetJiraRequirements(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const designService = new JiraDesignService(jiraConfig);
    const requirements = await designService.getRequirements();

    res.json(requirements);
  } catch (error: any) {
    console.error("[Get Jira Requirements] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira requirements",
      details: error.stack,
    });
  }
}

/**
 * Get development work items
 * GET /api/sdlc/projects/:projectId/jira/development/work-items
 */
export async function handleGetJiraDevelopmentWorkItems(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const developmentService = new JiraDevelopmentService(jiraConfig);
    const workItems = await developmentService.getDevelopmentWorkItems();

    res.json(workItems);
  } catch (error: any) {
    console.error("[Get Jira Development Work Items] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira development work items",
      details: error.stack,
    });
  }
}

/**
 * Get story progress for development phase
 * GET /api/sdlc/projects/:projectId/jira/development/story-progress
 */
export async function handleGetJiraStoryProgress(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const developmentService = new JiraDevelopmentService(jiraConfig);
    const progress = await developmentService.getStoryProgress();

    res.json(progress);
  } catch (error: any) {
    console.error("[Get Jira Story Progress] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira story progress",
      details: error.stack,
    });
  }
}

/**
 * Get developer assignments for development phase
 * GET /api/sdlc/projects/:projectId/jira/development/developer-assignments
 */
export async function handleGetJiraDeveloperAssignments(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const developmentService = new JiraDevelopmentService(jiraConfig);
    const assignments = await developmentService.getDeveloperAssignments();

    res.json(assignments);
  } catch (error: any) {
    console.error("[Get Jira Developer Assignments] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira developer assignments",
      details: error.stack,
    });
  }
}

/**
 * Get velocity indicators for development phase
 * GET /api/sdlc/projects/:projectId/jira/development/velocity
 */
export async function handleGetJiraVelocity(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const developmentService = new JiraDevelopmentService(jiraConfig);
    const velocity = await developmentService.getVelocityIndicators();

    res.json(velocity);
  } catch (error: any) {
    console.error("[Get Jira Velocity] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira velocity indicators",
      details: error.stack,
    });
  }
}

/**
 * Get build pipelines (if available)
 * GET /api/sdlc/projects/:projectId/jira/build/pipelines
 */
export async function handleGetJiraBuildPipelines(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const buildService = new JiraBuildService(jiraConfig);
    const pipelines = await buildService.getBuildPipelines();

    res.json(pipelines);
  } catch (error: any) {
    console.error("[Get Jira Build Pipelines] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira build pipelines",
      details: error.stack,
    });
  }
}

/**
 * Get build status metrics
 * GET /api/sdlc/projects/:projectId/jira/build/metrics
 */
export async function handleGetJiraBuildMetrics(req: Request, res: Response) {
  try {
    const { projectId } = req.params;

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration is required. Please configure in Settings."
      });
    }

    const buildService = new JiraBuildService(jiraConfig);
    const metrics = await buildService.getBuildStatusMetrics();

    res.json(metrics);
  } catch (error: any) {
    console.error("[Get Jira Build Metrics] Error:", error);
    res.status(500).json({
      error: error.message || "Failed to get Jira build metrics",
      details: error.stack,
    });
  }
}

/**
 * Get project count for a Jira connection.
 * Uses the same listing rules as GET /api/ado-projects so counts stay in sync
 * with the Projects page and organization cards.
 */
export async function handleGetJiraConnectionProjectCount(req: Request, res: Response) {
  try {
    const { connectionId } = req.params;

    if (!connectionId) {
      return res.status(400).json({ error: 'Missing connectionId' });
    }

    const connection = await db
      .select()
      .from(schema.jiraConnections)
      .where(eq(schema.jiraConnections.id, connectionId))
      .limit(1);

    if (connection.length === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const userId = (req as any).user?.id;
    const { countListedJiraProjectsForConnection } = await import("./jira-project-listing");
    const count = await countListedJiraProjectsForConnection(userId, connectionId);

    return res.json({ count, source: 'listed' });
  } catch (error) {
    console.error('[handleGetJiraConnectionProjectCount] Error:', error);
    return res.status(500).json({ error: 'Failed to get Jira project count' });
  }
}

/**
 * Push test cases to Jira
 * POST /api/sdlc/projects/:projectId/jira/push-test-cases
 */
export async function handlePushTestCasesToJira(req: Request, res: Response) {
  try {
    const { projectId: projectIdParam } = req.params;
    const { testCases, testCasesByCategory, userStory, projectId: bodyProjectId } = req.body;
    
    const projectId = projectIdParam || bodyProjectId;

    // Resolve the categorized test cases: prefer testCasesByCategory, fall back to testCases
    const categorized = testCasesByCategory || testCases;

    if (!categorized || !userStory || !projectId) {
      return res.status(400).json({
        error: "Missing required parameters: testCases, userStory, projectId",
      });
    }

    const jiraConfig = await getJiraConfig(projectId);
    if (!jiraConfig) {
      return res.status(400).json({
        error: "Jira configuration not found or project is not Jira-integrated."
      });
    }

    const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
    const pushService = new JiraPushService(jiraService);
    
    const parentStoryKey = userStory.jiraIssueId || userStory.id;
    
    if (!parentStoryKey || parentStoryKey.toString().includes('story-')) {
      return res.status(400).json({
        error: "User story must be pushed to Jira before test cases can be linked.",
        details: "Please push the user story to Jira in the Development phase first."
      });
    }

    // Build a flat list of all test cases from either categorized object or flat array
    let allCases: any[] = [];
    if (Array.isArray(categorized)) {
      allCases = categorized;
    } else if (typeof categorized === "object") {
      for (const key of ["functional", "negative", "edgeCases", "accessibility", "performance", "security", "usability", "reliability"]) {
        if (Array.isArray(categorized[key])) {
          allCases.push(...categorized[key]);
        }
      }
    }

    console.log(`[JiraRoutesHandler] Pushing ${allCases.length} test cases to Jira for story ${parentStoryKey}`);

    if (allCases.length === 0) {
      return res.json({
        success: true,
        summary: { total: 0, created: 0, skipped: 0, failed: 0 },
        results: [],
        createdKeys: [],
        errors: [],
      });
    }

    // ASYNC-JOB PATTERN: Each test case requires (a) a JQL duplicate-check
    // call and (b) an issue create call — typically 2 round-trips per test
    // case. With 20+ test cases this easily exceeds AWS API Gateway's 29s
    // timeout (which surfaces as a 503 Service Unavailable). Run the per-
    // case loop in a background job and have the client poll
    // `GET /api/jobs/test-cases-push-to-jira/status/:jobId`.
    const totalCases = allCases.length;
    const { jobId } = asyncJobManager.start(
      "test-cases-push-to-jira",
      async ({ updateProgress }) => {
        updateProgress(5, `Pushing ${totalCases} test case(s) to Jira`);

        const issueTypes = await (pushService as any).getProjectIssueTypes();
        const testCaseType = issueTypes.find((t: any) =>
          (t.name || '').toLowerCase().includes('test') &&
          (t.name || '').toLowerCase().includes('case')
        );
        const testCaseTypeName = testCaseType?.name || 'Test Case';

        const createdKeys: string[] = [];
        const skippedKeys: string[] = [];
        const errors: Array<{ title: string; error: string }> = [];
        const pushResults: Array<{ title: string; status: string; key?: string; error?: string }> = [];

        let processed = 0;
        for (const tc of allCases) {
          if (!tc || !tc.title) {
            processed += 1;
            continue;
          }
          try {
            const existingKey = await pushService.findWorkItemByTitle(tc.title, testCaseTypeName);
            if (existingKey) {
              console.log(`[JiraRoutesHandler] Skipping duplicate: "${tc.title}" (${existingKey})`);
              skippedKeys.push(existingKey);
              pushResults.push({ title: tc.title, status: "skipped", key: existingKey });
            } else {
              const key = await pushService.createTestCase(tc, parentStoryKey);
              createdKeys.push(key);
              pushResults.push({ title: tc.title, status: "created", key });
            }
          } catch (err: any) {
            errors.push({ title: tc.title, error: err.message });
            pushResults.push({ title: tc.title, status: "failed", error: err.message });
          }
          processed += 1;
          // Spread progress 10..95 across the loop for nicer UX feedback.
          const pct = totalCases > 0 ? 10 + Math.floor((processed / totalCases) * 85) : 95;
          updateProgress(pct, `Pushing ${processed}/${totalCases} test case(s) to Jira`);
        }

        const totalCreated = createdKeys.length;
        const totalSkipped = skippedKeys.length;
        const totalErrors = errors.length;

        return {
          success: totalErrors === 0,
          summary: {
            total: allCases.length,
            created: totalCreated,
            skipped: totalSkipped,
            failed: totalErrors,
          },
          results: pushResults,
          message: totalErrors === 0
            ? `Successfully processed test cases. Created: ${totalCreated}, Skipped (duplicates): ${totalSkipped}.`
            : `Processed with ${totalErrors} errors. Created: ${totalCreated}, Skipped: ${totalSkipped}.`,
          createdKeys,
          skippedKeys,
          errors,
        };
      },
      `Pushing ${totalCases} test case(s) to Jira`,
    );

    return res.status(202).json({
      success: true,
      jobId,
      status: "processing",
      message: `Push started. Poll /api/jobs/test-cases-push-to-jira/status/${jobId} for status.`,
    });

  } catch (error: any) {
    console.error("[Push Test Cases to Jira] Error:", error);
    if (isUserJiraCredentialError(error)) {
      return res.status(userJiraCredentialHttpStatus(error)).json({
        error: userJiraCredentialMessage(error),
        details: error.message || String(error),
      });
    }
    res.status(500).json({
      error: error.message || "Failed to push test cases to Jira",
      details: error.stack,
    });
  }
}
