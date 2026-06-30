
import type { Express, Request, Response, NextFunction } from "express";
import { getJiraConfig } from "./integrations/jira/jira-routes-handler";
import { JiraService } from "./integrations/jira/jira-service";
import { resolveIssueType } from "./integrations/jira/strategies/hierarchy-strategy";
import { convertToADF, mapDevXPriorityToJira } from "./integrations/jira/jira-mappers";

/**
 * Resolve the chosen "work item type" against the actual issue types that
 * exist in the user's Jira project. Different Jira projects expose different
 * sets of issue types (e.g. a bare "Task / Sub-task" project has no Story or
 * Epic), so the previous hardcoded mapping ("User Story" → "Story") would
 * cause Jira to reject the request with
 *   {"errors":{"issuetype":"The issue type selected is invalid."}}
 *
 * Returns the best-matching { id, name } from the project, or null if the
 * project has no createable types at all.
 */
async function resolveJiraIssueTypeForProject(
  jiraService: JiraService,
  projectKey: string,
  workItemType: string,
): Promise<{ id: string; name: string } | null> {
  const availableTypes = await (jiraService as any).getIssueTypesForProject(projectKey);
  if (!availableTypes || availableTypes.length === 0) {
    return null;
  }

  // Normalize "User Story" / "user-story" → "user story" before resolving.
  const normalized = (workItemType || "").trim().toLowerCase().replace(/[-_]/g, " ");
  const aliasMap: Record<string, string> = {
    "user story": "user story",
    story: "user story",
    epic: "epic",
    feature: "feature",
    task: "task",
    bug: "bug",
    issue: "task",
    "sub task": "sub-task",
    subtask: "sub-task",
  };
  const target = aliasMap[normalized] || normalized;

  return resolveIssueType(target, availableTypes);
}

export function registerHubArtifactsJiraPostRoute(app: Express) {
  app.patch(
    "/api/hub/artifacts/:projectName/work-item/:workItemId",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workItemId } = req.params;
        const { projectId, project } = req.query as {
          projectId?: string;
          project?: string;
        };
        const projectKey = projectId || project;
        if (!projectKey) {
          // Defer to the ADO handler in routes.ts when we don't have a
          // project identifier — that route accepts artifactOrgId/organizationUrl.
          return next();
        }
        const jiraConfig = await getJiraConfig(projectKey);
        if (!jiraConfig) {
          // Not a Jira project (e.g. Azure DevOps). Let the ADO PATCH handler
          // in routes.ts handle this request.
          return next();
        }
        const jiraService = new JiraService(jiraConfig);

        // Translate the dialog's `assignedTo` (accountId for Jira projects)
        // into the `assignee` field that JiraService.updateWorkItem expects.
        // Empty string / "Unassigned" clears the assignee.
        const updateData: any = { ...req.body };
        if (Object.prototype.hasOwnProperty.call(updateData, "assignedTo")) {
          const v = updateData.assignedTo;
          updateData.assignee =
            v === "" || v === null || v === undefined || v === "Unassigned"
              ? null
              : String(v);
          delete updateData.assignedTo;
        }

        try {
          const updatedWorkItem = await jiraService.updateWorkItem(workItemId, updateData);
          if (updatedWorkItem) {
            return res.json(updatedWorkItem);
          } else {
            return res.status(404).json({ error: "Work item not found or could not be updated" });
          }
        } catch (err: any) {
          return res
            .status(500)
            .json({ error: "Failed to update Jira work item", details: err?.message || String(err) });
        }
      } catch (error: any) {
        console.error("[Jira PATCH Work Item] Error:", error);
        res.status(500).json({ error: "Failed to update Jira work item", details: error.message });
      }
    },
  );

  app.post(
    "/api/hub/artifacts/:projectName/work-item",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { projectId, project } = req.query as {
          projectId?: string;
          project?: string;
        };
        const projectKey = projectId || project;
        if (!projectKey) {
          // No project identifier → let the ADO POST handler take it.
          return next();
        }
        const jiraConfig = await getJiraConfig(projectKey);
        if (!jiraConfig) {
          // Not a Jira project — fall through to the ADO POST handler
          // registered later in routes.ts. Without next() here the ADO flow
          // was completely broken (it would always 400 with "Jira project
          // not configured or not found").
          return next();
        }

        const {
          workItemType,
          title,
          description,
          priority,
          storyPoints,
          acceptanceCriteria,
          tags,
          assignedTo,
        } = req.body;

        if (!workItemType || !title) {
          return res.status(400).json({ error: "Work item type and title are required" });
        }

        const jiraService = new JiraService(jiraConfig);

        const resolvedType = await resolveJiraIssueTypeForProject(
          jiraService,
          jiraConfig.projectKey,
          workItemType,
        );

        if (!resolvedType) {
          return res.status(400).json({
            error:
              "Jira project has no creatable issue types, or the configured user lacks permission to create issues. " +
              "Please verify the Jira project configuration and API token permissions.",
          });
        }

        if (resolvedType.name.toLowerCase() !== String(workItemType).toLowerCase()) {
          console.log(
            `[Jira POST Work Item] Mapped requested type "${workItemType}" → Jira issue type "${resolvedType.name}" (id:${resolvedType.id}) for project ${jiraConfig.projectKey}`,
          );
        }

        const fieldMapping = await jiraService.getFieldMapping();

        // Build the Jira payload directly so we can use the resolved issue
        // type id (team-managed projects often only accept ids, not names).
        const fields: Record<string, any> = {
          project: { key: (jiraConfig.projectKey || "").trim().toUpperCase() },
          summary: String(title).slice(0, 255),
          issuetype: { id: resolvedType.id },
        };

        if (description) {
          fields.description = convertToADF(String(description));
        }

        if (priority !== undefined && priority !== null && priority !== "") {
          fields.priority = { name: mapDevXPriorityToJira(String(priority)) };
        }

        if (
          storyPoints !== undefined &&
          storyPoints !== null &&
          storyPoints !== "" &&
          fieldMapping.storyPointsFieldId
        ) {
          const sp = Number(storyPoints);
          if (!Number.isNaN(sp)) {
            fields[fieldMapping.storyPointsFieldId] = sp;
          }
        }

        if (acceptanceCriteria && fieldMapping.acceptanceCriteriaFieldId) {
          fields[fieldMapping.acceptanceCriteriaFieldId] = String(acceptanceCriteria);
        }

        if (tags) {
          // Jira labels can't contain spaces; split on `;` or whitespace
          // and drop empties to stay safe.
          const labels = String(tags)
            .split(/[;\s,]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          if (labels.length > 0) {
            fields.labels = labels;
          }
        }

        // Assignee: dialog sends Jira accountId (from the assignable-users
        // dropdown). Tolerate an email fallback by resolving it server-side.
        if (assignedTo && assignedTo !== "Unassigned" && String(assignedTo).trim() !== "") {
          let accountId = String(assignedTo).trim();
          if (accountId.includes("@")) {
            const resolved = await jiraService.findUserByEmail(accountId);
            if (resolved?.accountId) {
              accountId = resolved.accountId;
            } else {
              console.warn(
                `[Jira POST Work Item] Could not resolve assignee email "${assignedTo}" to a Jira accountId; leaving issue unassigned`,
              );
              accountId = "";
            }
          }
          if (accountId) {
            fields.assignee = { accountId };
          }
        }

        const created = await (jiraService as any).request("/issue", {
          method: "POST",
          body: JSON.stringify({ fields }),
        });

        // Return a shape compatible with the create dialog's success handler.
        return res.json({
          id: created.key || created.id,
          key: created.key,
          jiraId: created.id,
          type: resolvedType.name,
          requestedType: workItemType,
          projectKey: jiraConfig.projectKey,
          source: "Jira",
        });
      } catch (error: any) {
        console.error("[Jira POST Work Item] Error:", error);
        res.status(500).json({
          error: "Failed to create Jira work item",
          details: error.message,
        });
      }
    },
  );
}
