import type { Express, Request, Response } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { JiraPushService } from "../integrations/jira/jira-push-service";
import {
  getJiraConfig,
  getJiraServiceForWrite,
  isUserJiraCredentialError,
  userJiraCredentialHttpStatus,
  userJiraCredentialMessage,
} from "../integrations/jira/jira-routes-handler";
import { autoBootstrapUser, requireAuth } from "../auth/middleware";
import { asyncJobManager } from "../lib/async-job-manager";
import type { Epic, Feature, UserStory, Persona } from "@shared/schema";

function handleJiraCredentialResponse(res: Response, error: unknown): boolean {
  if (!isUserJiraCredentialError(error)) return false;
  res.status(userJiraCredentialHttpStatus(error)).json({
    error: userJiraCredentialMessage(error),
    details: error instanceof Error ? error.message : String(error),
  });
  return true;
}

export function registerHubArtifactsJiraRoutes(app: Express): void {
  /**
   * List assignable Jira users for a project (Artifacts).
   * Used by the work-item create/edit dialog's "Assigned To" dropdown.
   *
   * GET /api/hub/artifacts/jira/:projectName/users?projectId=...&query=...
   */
  app.get(
    "/api/hub/artifacts/jira/:projectName/users",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { projectName } = req.params;
        const { projectId, query } = req.query as {
          projectId?: string;
          query?: string;
        };

        if (!projectId) {
          return res.status(400).json({ error: "projectId is required" });
        }

        let jiraConfig = await getJiraConfig(projectId);

        // Same fallback shape as the work-items endpoint below: look up by
        // project name when projectId didn't resolve to Jira config.
        if (!jiraConfig) {
          const [project] = await db
            .select()
            .from(schema.sdlcProjects)
            .where(eq(schema.sdlcProjects.name, projectName))
            .limit(1);
          if (project && project.integrationType === "jira") {
            jiraConfig = await getJiraConfig(project.id);
          }
        }

        if (!jiraConfig) {
          return res
            .status(400)
            .json({ error: "Jira project not configured or not found" });
        }

        const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
        const users = await jiraService.getAssignableUsers(
          jiraConfig.projectKey,
          (query || "").trim(),
        );

        return res.json({
          users: users.map((u) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress,
            active: u.active,
          })),
        });
      } catch (error) {
        console.error("[Hub Artifacts Jira] Error fetching users:", error);
        if (handleJiraCredentialResponse(res, error)) return;
        return res.status(500).json({
          error: "Failed to fetch Jira users",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

        /**
         * Update a single work item for a Jira project (Artifacts)
         */
        app.patch("/api/hub/artifacts/jira/:projectName/work-item/:workItemId", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
          try {
            const { projectName, workItemId } = req.params;
            const { projectId } = req.query;

            if (!projectId) {
              return res.status(400).json({ error: "projectId is required" });
            }

            const jiraConfig = await getJiraConfig(projectId as string);
            if (!jiraConfig) {
              return res.status(400).json({ error: "Jira project not configured or not found" });
            }

            const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
            // The updateWorkItem method should exist in JiraService; if not, implement accordingly
            const updateData = req.body;
            try {
              const updatedWorkItem = await jiraService.updateWorkItem(workItemId, updateData);
              if (updatedWorkItem) {
                return res.json({
                  ...updatedWorkItem,
                  createdDate: updatedWorkItem.createdAt,
                  changedDate: updatedWorkItem.updatedAt,
                  createdBy: updatedWorkItem.createdBy,
                });
              } else {
                return res.status(404).json({ error: "Work item not found or could not be updated" });
              }
            } catch (err: any) {
              return res.status(500).json({ error: "Failed to update Jira work item", details: err?.message || String(err) });
            }
          } catch (error) {
            console.error("[Hub Artifacts Jira] Error updating work item:", error);
            if (handleJiraCredentialResponse(res, error)) return;
            return res.status(500).json({ error: "Failed to update Jira work item", details: error instanceof Error ? error.message : String(error) });
          }
        });
    /**
   * Get a single Jira work-item's details (for the Hub Artifacts details
   * dialog). Mirrors the ADO `GET /api/hub/artifacts/:projectName/work-item/:workItemId`
   * route but for Jira projects, returning the same `DetailedWorkItem`
   * shape the existing client dialog expects — with `parent` and
   * `children` summary lists.
   *
   * `workItemId` here is the Jira issue's internal id (the value we
   * already expose as `WorkItem.id` via `mapJiraIssueToWorkItem`). The
   * Jira REST `/issue/{idOrKey}` endpoint accepts either id or key, so
   * the Jira issue key (e.g. `PROJ-123`) also works.
   */
  app.get(
    "/api/hub/artifacts/jira/:projectName/work-item/:workItemId",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { projectName, workItemId } = req.params;
        const { projectId } = req.query;

        if (!projectId && !projectName) {
          return res
            .status(400)
            .json({ error: "projectId or projectName is required" });
        }

        let jiraConfig = projectId
          ? await getJiraConfig(projectId as string)
          : null;
        if (!jiraConfig) {
          const [project] = await db
            .select()
            .from(schema.sdlcProjects)
            .where(eq(schema.sdlcProjects.name, projectName))
            .limit(1);
          if (project && project.integrationType === "jira") {
            jiraConfig = await getJiraConfig(project.id);
          }
        }
        if (!jiraConfig) {
          return res
            .status(400)
            .json({ error: "Jira project not configured or not found" });
        }

        const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
        const workItem = await jiraService.getWorkItem(workItemId);
        if (!workItem) {
          return res
            .status(404)
            .json({ error: `Jira work item ${workItemId} not found` });
        }

        const cleanInstanceUrl = jiraConfig.instanceUrl.replace(/\/$/, "");
        const issueUrl = workItem.externalId
          ? `${cleanInstanceUrl}/browse/${workItem.externalId}`
          : "";

        type Summary = {
          id: string;
          title: string;
          type: string;
          state: string;
          url: string;
        };
        const toSummary = (wi: typeof workItem): Summary => ({
          id: wi.id,
          title: wi.title,
          type: wi.type,
          state: wi.status,
          url: wi.externalId
            ? `${cleanInstanceUrl}/browse/${wi.externalId}`
            : "",
        });

        // Best-effort parent lookup (parentId is usually the parent key).
        let parent: Summary | null = null;
        if (workItem.parentId) {
          try {
            const parentItem = await jiraService.getWorkItem(workItem.parentId);
            if (parentItem) parent = toSummary(parentItem);
          } catch (parentErr) {
            console.warn(
              "[Hub Artifacts Jira] Failed to fetch parent issue:",
              parentErr,
            );
          }
        }

        // Children via JQL: covers modern Hierarchy (Parent) AND classic
        // Company-managed Epic Link, OR'd + deduped.
        // `searchIssuesByJql` returns minimal shape ({id, key, title, status,
        // type}) which is exactly what `Summary` needs — no per-child detail
        // fetch required.
        const children: Summary[] = [];
        const childIssueKey = workItem.externalId || workItem.id;
        if (childIssueKey) {
          try {
            const quoted = `"${childIssueKey.replace(/"/g, '\\"')}"`;
            const jql = `parent = ${quoted} OR "Epic Link" = ${quoted} ORDER BY created ASC`;
            const childIssues = await jiraService.searchIssuesByJql(jql, 100);
            const seen = new Set<string>();
            for (const ch of childIssues) {
              const id = String(ch?.id || ch?.key || "");
              if (!id || seen.has(id)) continue;
              seen.add(id);
              children.push({
                id,
                title: ch.title || "",
                type: ch.type || "",
                state: ch.status || "",
                url: ch.key ? `${cleanInstanceUrl}/browse/${ch.key}` : "",
              });
            }
          } catch (childErr) {
            console.warn(
              "[Hub Artifacts Jira] Failed to fetch child issues:",
              childErr,
            );
          }
        }

        // Match the ADO `DetailedWorkItem` shape the existing client dialog
        // renders, with `null` for fields Jira doesn't expose.
        const detailed = {
          id: workItem.id,
          title: workItem.title,
          type: workItem.type,
          state: workItem.status,
          assignedTo: workItem.assignee ?? "",
          createdBy: workItem.createdBy ?? "",
          createdDate: workItem.createdAt
            ? new Date(workItem.createdAt).toISOString()
            : "",
          changedDate: workItem.updatedAt
            ? new Date(workItem.updatedAt).toISOString()
            : "",
          description: workItem.description ?? "",
          acceptanceCriteria: workItem.acceptanceCriteria ?? "",
          storyPoints: workItem.storyPoints ?? null,
          priority: null,
          severity: null,
          businessValue: null,
          timeCriticality: null,
          effort: null,
          remainingWork: null,
          originalEstimate: null,
          completedWork: null,
          reproSteps: "",
          tags: "",
          iterationPath: "",
          areaPath: "",
          url: issueUrl,
          externalId: workItem.externalId ?? "",
          source: "Jira" as const,
          relations: [],
          parent,
          children,
        };

        return res.json(detailed);
      } catch (error) {
        console.error(
          "[Hub Artifacts Jira] Error fetching work item details:",
          error,
        );
        if (handleJiraCredentialResponse(res, error)) return;
        return res.status(500).json({
          error: "Failed to fetch Jira work item details",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
  /**
   * Get work items for a Jira project (Artifacts)
   */
  app.get("/api/hub/artifacts/jira/:projectName/work-items", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectName } = req.params;
      const { projectId } = req.query;

      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const jiraConfig = await getJiraConfig(projectId as string);
      
      if (!jiraConfig) {
        const [project] = await db
          .select()
          .from(schema.sdlcProjects)
          .where(eq(schema.sdlcProjects.name, projectName))
          .limit(1);
        if (project && project.integrationType === 'jira') {
          const config = await getJiraConfig(project.id);
          if (config) {
            const jiraService = await getJiraServiceForWrite(req, config.projectKey, config.instanceUrl);
            const backlog = await jiraService.getBacklogContext();
            return res.json(buildHierarchy(backlog));
          }
        }
        return res.status(400).json({ error: "Jira project not configured or not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
      const backlog = await jiraService.getBacklogContext();
      return res.json(buildHierarchy(backlog));

    } catch (error) {
      console.error("[Hub Artifacts Jira] Error fetching artifacts:", error);
      if (handleJiraCredentialResponse(res, error)) return;
      return res.status(500).json({ 
        error: "Failed to fetch Jira artifacts", 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  /**
   * Push a draft artifact to Jira
   */
  app.post("/api/hub/artifacts/push-to-jira", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        projectId,
        selectedItem,
        epics: epicsFromRequest,
        features: featuresFromRequest,
        userStories: userStoriesFromRequest,
        artifactId,
        brdId,
        requirementIds,
      } = req.body;

      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const jiraConfig = await getJiraConfig(projectId);
      if (!jiraConfig) {
        return res.status(400).json({ error: "Jira project configuration not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, jiraConfig.projectKey, jiraConfig.instanceUrl);
      const jiraPushService = new JiraPushService(jiraService);

      const effectiveContext = await fetchTraceabilityContext(artifactId, brdId, requirementIds);
      const personas = await storage.getPersonas();

      const selectedItems: Array<{ type: 'epic' | 'feature' | 'story'; id: string }> = [];
      if (selectedItem.type === "epic") selectedItems.push({ type: 'epic', id: selectedItem.id });
      else if (selectedItem.type === "feature") selectedItems.push({ type: 'feature', id: selectedItem.id });
      else if (selectedItem.type === "story" || selectedItem.type === "user-story") {
        selectedItems.push({ type: 'story', id: selectedItem.id });
      }

      const authUser = (req as any).user;
      const pushedBy = authUser?.email
        ? { email: authUser.email, displayName: authUser.displayName }
        : undefined;

      // ASYNC-JOB PATTERN: Even pushing a single story can fan out into many
      // Jira API calls (sub-tasks + test cases when createSubtasks=true), so
      // this route is at risk of AWS API Gateway's 29s timeout. Run in
      // background and have the client poll
      // `GET /api/jobs/hub-artifacts-push-to-jira/status/:jobId`.
      const { jobId } = asyncJobManager.start(
        "hub-artifacts-push-to-jira",
        async ({ updateProgress }) => {
          updateProgress(10, "Pushing to Jira");
          const result = await jiraPushService.pushWorkItems(
            selectedItems,
            epicsFromRequest,
            featuresFromRequest,
            userStoriesFromRequest,
            personas,
            {
              brdId: effectiveContext.brdId,
              requirementIds: effectiveContext.requirementIds,
              createSubtasks: true,
              skipDuplicateCheck: true,
              pushedBy,
            }
          );
          updateProgress(100, "Pushed to Jira");
          return { success: true, message: "Successfully pushed to Jira", result };
        },
        "Pushing to Jira",
      );

      res.status(202).json({
        success: true,
        jobId,
        status: "processing",
        message: `Push to Jira started. Poll /api/jobs/hub-artifacts-push-to-jira/status/${jobId} for status.`,
      });

    } catch (error: any) {
      console.error("[Hub Artifacts Jira] Error pushing to Jira:", error);
      if (handleJiraCredentialResponse(res, error)) return;
      res.status(500).json({ error: "Failed to push to Jira", details: error.message });
    }
  });
}

/**
 * Helper to build hierarchy from backlog context.
 * Uses parentId linkage to nest items.
 * Tags every node with `source: "Jira"` so the client can render the
 * correct origin badge (and not fall back to the ADO label).
 *
 * IMPORTANT: in the WorkItem shape returned by `mapJiraIssueToWorkItem`:
 *   - `id`         is Jira's numeric internal ID (e.g. "10001")
 *   - `externalId` is the Jira issue key (e.g. "ISTEST-2")
 *   - `parentId`   comes from `fields.parent.key` — i.e. the issue KEY
 *
 * So we have to index the lookup map by BOTH the numeric id and the issue
 * key, otherwise sub-tasks (whose parent is referenced by key) never get
 * nested under their parent and the "Linked" tab shows nothing.
 */
function buildHierarchy(backlog: any) {
  const epics = Array.isArray(backlog?.epics) ? backlog.epics : [];
  const features = Array.isArray(backlog?.features) ? backlog.features : [];
  const userStories = Array.isArray(backlog?.userStories) ? backlog.userStories : [];
  const allItems = [...epics, ...features, ...userStories];

  const rawStories = Array.isArray(backlog?._rawStories) ? backlog._rawStories : [];

  const normalize = (value: unknown): string => String(value ?? '').trim().toUpperCase();

  const extractParentCandidates = (parentRef: unknown): string[] => {
    const raw = String(parentRef ?? '').trim();
    if (!raw) return [];

    const candidates = new Set<string>();
    candidates.add(raw);

    const browseMatch = raw.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i);
    if (browseMatch?.[1]) {
      candidates.add(browseMatch[1]);
    }

    const keyMatch = raw.match(/([A-Z][A-Z0-9_]*-\d+)/i);
    if (keyMatch?.[1]) {
      candidates.add(keyMatch[1]);
    }

    return Array.from(candidates);
  };

  // Keep Jira-native hierarchy for Hubs Epic tab:
  // Epic -> (Task and Story siblings) -> Subtasks under Story.

  // Source of truth: one entry per item, looked up via two indexes.
  type Node = { item: any; childIds: Set<string> };
  const nodesById = new Map<string, Node>();
  const nodesByKey = new Map<string, Node>(); // key === externalId
  const nodesByNormalizedId = new Map<string, Node>();
  const nodesByNormalizedKey = new Map<string, Node>();

  allItems.forEach(item => {
    const node: Node = {
      item: { ...item, source: "Jira", linkedItems: [] },
      childIds: new Set<string>(),
    };
    if (item.id) {
      const id = String(item.id).trim();
      nodesById.set(id, node);
      nodesByNormalizedId.set(normalize(id), node);
    }
    if (item.externalId) {
      const key = String(item.externalId).trim();
      nodesByKey.set(key, node);
      nodesByNormalizedKey.set(normalize(key), node);
    }
  });

  const findParent = (parentRef: any): Node | undefined => {
    if (!parentRef) return undefined;

    for (const candidate of extractParentCandidates(parentRef)) {
      const normalizedCandidate = normalize(candidate);
      const matched =
        nodesByKey.get(candidate) ||
        nodesById.get(candidate) ||
        nodesByNormalizedKey.get(normalizedCandidate) ||
        nodesByNormalizedId.get(normalizedCandidate);

      if (matched) return matched;
    }

    return undefined;
  };

  const itemsAddedAsChildren = new Set<string>();

  nodesById.forEach((node) => {
    const parent = findParent(node.item.parentId);
    if (parent && parent !== node) {
      // Avoid pushing the same child twice (defensive — shouldn't happen,
      // but Jira occasionally returns duplicates across the epic/story
      // queries when an item matches both).
      const childId = String(node.item.id);
      if (!parent.childIds.has(childId)) {
        parent.item.linkedItems.push(node.item);
        parent.childIds.add(childId);
      }
      itemsAddedAsChildren.add(childId);
    }
  });

  // Add sub-tasks under each story node to support the full expansion chain:
  // Epic -> Task -> User Story -> Sub-task.
  const findNodeByIssueRef = (issueRef: any): Node | undefined => findParent(issueRef);

  for (const rawStory of rawStories) {
    const storyNode = findNodeByIssueRef(rawStory?.key || rawStory?.id);
    if (!storyNode) continue;

    const subtasks = Array.isArray(rawStory?.fields?.subtasks) ? rawStory.fields.subtasks : [];
    for (const subtask of subtasks) {
      const subtaskId = String(subtask?.id || subtask?.key || '').trim();
      if (!subtaskId || storyNode.childIds.has(subtaskId)) continue;

      storyNode.item.linkedItems.push({
        id: subtaskId,
        externalId: String(subtask?.key || '').trim(),
        title: String(subtask?.fields?.summary || 'Untitled'),
        description: '',
        type: 'Task',
        status: String(subtask?.fields?.status?.name || 'New'),
        assignee:
          subtask?.fields?.assignee?.emailAddress ||
          subtask?.fields?.assignee?.displayName ||
          undefined,
        priority: String(subtask?.fields?.priority?.name || 'medium'),
        parentId: String(rawStory?.key || rawStory?.id || '').trim(),
        source: 'Jira',
        linkedItems: [],
      });
      storyNode.childIds.add(subtaskId);
    }
  }

  const rootItems: any[] = [];
  nodesById.forEach((node) => {
    const id = String(node.item.id);
    if (!itemsAddedAsChildren.has(id)) {
      rootItems.push(node.item);
    }
  });

  return rootItems;
}

async function fetchTraceabilityContext(artifactId?: string, brdId?: string, requirementIds?: string[]) {
  let effectiveBrdId = brdId;
  let effectiveRequirementIds = requirementIds || [];

  if (artifactId) {
    try {
      const requirementRows = await db
        .select({
          id: schema.devBrdRequirements.id,
          brdId: schema.devBrdRequirements.brdId,
        })
        .from(schema.devBrdRequirements)
        .where(eq(schema.devBrdRequirements.workflowId, artifactId));

      if (requirementRows.length > 0) {
        effectiveBrdId = requirementRows[0].brdId;
        effectiveRequirementIds = requirementRows.map((row) => row.id);
      }
    } catch (traceError) {
      console.warn("[Jira Traceability] Failed to fetch requirement IDs:", traceError);
    }
  }

  return { brdId: effectiveBrdId, requirementIds: effectiveRequirementIds };
}

export async function pushJiraBulk(
  req: Request,
  projectId: string,
  selectedItems: any[],
  epics: Epic[],
  features: Feature[],
  userStories: UserStory[],
  artifactId?: string,
  brdId?: string,
  requirementIds?: string[]
) {
  const config = await getJiraConfig(projectId);
  if (!config) throw new Error("Jira project configuration not found");

  const jiraService = await getJiraServiceForWrite(req, config.projectKey, config.instanceUrl);
  const jiraPushService = new JiraPushService(jiraService);
  const personas = await storage.getPersonas();
  const context = await fetchTraceabilityContext(artifactId, brdId, requirementIds);

  return await jiraPushService.pushWorkItems(
    selectedItems,
    epics,
    features,
    userStories,
    personas,
    {
      brdId: context.brdId,
      requirementIds: context.requirementIds,
      createSubtasks: true,
      skipDuplicateCheck: true
    }
  );
}
