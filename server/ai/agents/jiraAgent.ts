import type { Agent, AgentRequest, AgentResponse } from "../superAgent/types";
import { getOptionalSuperAgentLlmClient } from "../superAgent/optionalLlmClient";
import { getJiraConfig } from "../../integrations/jira/jira-routes-handler";
import { JiraService } from "../../integrations/jira/jira-service";
import { getAllowedWorkItemPlatforms } from "../../platform/hosting";
import { db } from "../../db";
import { jiraConnections } from "@shared/schema";
import { desc, eq, and, or, inArray, sql } from "drizzle-orm";
import { decryptJiraToken } from "../../jira-routes";
import {
  getJiraServiceForUser,
  UserJiraCredentialInvalidError,
  UserJiraCredentialMissingError,
} from "../../integrations/jira/user-credential-resolver";
import * as schema from "@shared/schema";
import { getOptionalSuperAgentLlmClient } from "../superAgent/optionalLlmClient";

const openai = new Proxy({} as NonNullable<ReturnType<typeof getOptionalSuperAgentLlmClient>>, {
  get(_target, prop, receiver) {
    const client = getOptionalSuperAgentLlmClient();
    if (!client) {
      throw new Error("Jira Agent LLM client is not configured");
    }
    return Reflect.get(client, prop, receiver);
  },
});

const hasOpenAIConfigured = () => !!getOptionalSuperAgentLlmClient();

const PLACEHOLDER_PROJECT = "00000000-0000-0000-0000-000000000000";
const MAX_ORG_CHIPS = 8;
const MAX_ORGS_IN_PROMPT = 10;

function applySummaryPrefix(
  baseReply: string,
  context: AgentRequest["context"],
): string {
  const summary = context.summary?.trim();
  if (!summary) {
    return baseReply;
  }
  return (
    `Here is a summary of your previous conversation for context:\n` +
    `${summary}\n\n` +
    baseReply
  );
}

function resolveProjectId(context: AgentRequest["context"]): string | null {
  // Prefer the project the agent itself selected during conversation (via the
  // "Use Jira project: <KEY>" chip). Fall back to the UI-active project so
  // first-turn questions still target what the user is viewing.
  const id =
    context.agentSelectedProject?.id?.trim() ||
    context.selectedProject?.id?.trim();
  if (!id || id === PLACEHOLDER_PROJECT) {
    return null;
  }
  return id;
}

async function listTenantJiraConnections(userId?: string): Promise<
  Array<{ id: string; name: string; instanceUrl: string }>
> {
  if (!userId) {
    return [];
  }

  try {
    const { storage } = await import("../../storage");
    const visibleOrganizations = await storage.getVisibleOrganizations(userId);
    const visibleOrganizationIds = visibleOrganizations.map((org) => org.id);
    if (visibleOrganizationIds.length === 0) {
      return [];
    }

    return await db
      .select({
        id: jiraConnections.id,
        name: jiraConnections.name,
        instanceUrl: jiraConnections.instanceUrl,
      })
      .from(jiraConnections)
      .where(
        and(
          eq(jiraConnections.isActive, 1),
          inArray(jiraConnections.id, visibleOrganizationIds),
        ),
      )
      .orderBy(desc(jiraConnections.updatedAt))
      .limit(40);
  } catch (e) {
    console.error("[JiraAgent] listTenantJiraConnections:", e);
    return [];
  }
}

/** e.g. "show me the jira organization", "list jira connections" */
function isJiraOrgListingIntent(lower: string): boolean {
  if (!/\b(jira|atlassian)\b/i.test(lower)) return false;
  // If the user is also asking for projects (e.g. "show me the projects in the
  // organization"), let isJiraProjectsIntent handle it instead — they want
  // the project list, not another org list.
  if (/\bprojects?\b/i.test(lower)) return false;
  return /\b(orgs?|organizations?|instances?|connections?|sites?)\b/i.test(lower);
}

/** Standard chips: always **Query ADO data** before **Query Jira data** when both apply. */
function buildNavQuickReplies(adoOn: boolean, jiraOn: boolean): string[] {
  const q = [
    "List Jira issues",
    "Show Jira epics",
    "Jira project details",
    "Go to Settings",
  ];
  if (adoOn) q.push("Query ADO data");
  if (jiraOn) q.push("Query Jira data");
  q.push("What can you do in Astra?");
  return q;
}

function buildNoProjectHelpChips(adoOn: boolean, jiraOn: boolean): string[] {
  return [
    "View my settings",
    "Ask about Astra features",
    ...(adoOn ? (["Query ADO data"] as const) : []),
    ...(jiraOn ? (["Query Jira data"] as const) : []),
    "Show golden repos",
    "What is Jira integration?",
  ];
}

function isIssueListIntent(lower: string): boolean {
  return (
    /\b(list|show|get|fetch|view|display)\b.*\b(issues?|tickets?|bugs?|stories|backlog)\b/i.test(
      lower,
    ) || /\b(jira\s+)?(issues?|tickets?)\b/i.test(lower)
  );
}

function isTaskListIntent(lower: string): boolean {
  return (
    /\b(list|show|get|fetch|view|display)\b.*\b(tasks?)\b/i.test(lower) ||
    /\bjira\s+tasks?\b/i.test(lower)
  );
}

function isSubtaskListIntent(lower: string): boolean {
  return (
    /\b(list|show|get|fetch|view|display)\b.*\b(sub-?tasks?)\b/i.test(lower) ||
    /\bjira\s+sub-?tasks?\b/i.test(lower)
  );
}

function isEpicIntent(lower: string): boolean {
  return /\b(epics?)\b/i.test(lower) && /\b(list|show|get|fetch|view|jira)\b/i.test(lower);
}

function isProjectDetailsIntent(lower: string): boolean {
  return (
    /\b(project\s+details|jira\s+project|which\s+project|what\s+project)\b/i.test(lower) ||
    (/\bjira\b/i.test(lower) && /\bproject\b/i.test(lower) && /\b(details?|info|key|setup)\b/i.test(lower))
  );
}

/** e.g. "show me the jira projects", "list jira projects" */
function isJiraProjectsIntent(lower: string): boolean {
  // Don't confuse "Jira project details" / "info" / "key" with the projects-listing intent.
  if (/\bjira\s+project\s+(details?|info|key|setup|context)\b/i.test(lower)) {
    return false;
  }
  if (/\b(project)\s+(details?|info|key|setup|context)\b/i.test(lower)) {
    return false;
  }
  // If the user is asking about issues/epics/tasks/subtasks/stories/bugs
  // FROM a project, route to those handlers instead of the projects list.
  // Examples: "list tasks and subtasks from Jira project ASDF",
  // "show epics in DEVX890", "issues from project ABC".
  if (
    /\b(epics?|issues?|tickets?|tasks?|sub-?tasks?|stories|bugs?|backlog)\b/i.test(
      lower,
    )
  ) {
    // But still allow chip patterns like "List projects in <org>" which only
    // mention projects (no issue-type words).
    if (!/\bprojects?\s+in\b/i.test(lower)) {
      return false;
    }
  }
  return (
    /\b(list|show|get|fetch|view|display)\b.*\bprojects?\b/i.test(lower) ||
    /\bjira\s+projects?\b/i.test(lower) ||
    // Support quick-reply patterns like "List projects in <org>"
    /\bprojects?\s+in\b/i.test(lower)
  );
}

function formatProjectLines(
  items: Array<{ key?: string; name?: string; id?: string }>,
  limit: number,
): string {
  const slice = items.slice(0, limit);
  if (slice.length === 0) return "_No projects returned._";
  return slice
    .map((p, i) => {
      const label = p.name || p.key || p.id || `Project ${i + 1}`;
      const key = p.key ? ` (${p.key})` : "";
      return `${i + 1}. **${label}**${key}`;
    })
    .join("\n");
}

/**
 * "Find projects with issues" / "which projects have epics" / "scan projects".
 * The agent will probe each visible project for any issues and report a
 * summary of which contain content.
 */
function isFindProjectsWithContentIntent(lower: string): boolean {
  if (
    /\b(find|which|where|scan|search)\b.*\bprojects?\b.*\b(have|has|with|contain|containing)\b.*\b(epics?|issues?|tasks?|sub-?tasks?|stories|tickets?|bugs?|backlog|content|data|items?)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (/\bprojects?\s+with\s+(epics?|issues?|tasks?|sub-?tasks?|stories|tickets?|bugs?|content|data|items?)\b/i.test(lower)) {
    return true;
  }
  if (/\b(scan|probe)\s+(jira\s+)?projects?\b/i.test(lower)) {
    return true;
  }
  return false;
}

function isSelectJiraProjectIntent(lower: string): boolean {
  return (
    /^use\s+jira\s+project:\s*/i.test(lower) ||
    /^jira\s+project:\s*/i.test(lower) ||
    /^use\s+project:\s*/i.test(lower)
  );
}

/**
 * "user stories related to security" / "stories about payments" /
 * "what stories deal with authentication" / "find stories related to X".
 * Topic-driven semantic search across summary + description + labels.
 */
function isSemanticStoryIntent(lower: string): boolean {
  // Chip wording: "Find (user)stories related to security" / quick-reply style.
  if (/^find\s+(?:users?[\s-]*)?stor(?:y|ies)\s+related\s+to\s+/i.test(lower)) {
    return true;
  }
  if (
    /\b(users?[\s-]*stor(?:y|ies)|stor(?:y|ies)|issues?|tickets?|tasks?|epics?|bugs?)\b/i.test(
      lower,
    ) &&
    /\b(related\s+to|about|on|dealing\s+with|deal\s+with|involving|for|regarding|covering|matching|with\s+keyword|with\s+label)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  // "What X are related to Y?" forms.
  if (
    /^\s*what\s+/i.test(lower) &&
    /\b(users?[\s-]*stor(?:y|ies)|stor(?:y|ies)|issues?|tickets?|tasks?|epics?|bugs?)\b/i.test(
      lower,
    ) &&
    /\b(related|about|on|involving|deal\s*with)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Pull the topic the user is asking about from a semantic-search message.
 * Returns null if no meaningful topic can be extracted.
 */
function extractSemanticTopic(message: string): string | null {
  const cleaned = message.trim().replace(/[?.!]+$/g, "");

  // 1) "Find stories related to <topic>"
  const chip = cleaned.match(
    /^find\s+stories?\s+related\s+to\s+(.+)$/i,
  );
  if (chip?.[1]) return chip[1].trim();

  // 2) "... related to <topic>" / "... about <topic>" / "... involving <topic>"
  const tail = cleaned.match(
    /\b(?:related\s+to|about|on|dealing\s+with|involving|regarding|covering|for|with\s+keyword|with\s+label)\s+(.+)$/i,
  );
  if (tail?.[1]) {
    const t = tail[1].trim();
    // Strip trailing fragments like " in project X".
    return t.replace(/\s+in\s+(project|jira|the\s+project).*$/i, "").trim();
  }

  return null;
}

/**
 * "Which task has complex implementation?" / "most complex stories" /
 * "biggest estimates" / "highest story points" / "hardest tasks".
 * Drives the complexity-based ranking + plan-draft response.
 */
function isComplexityIntent(lower: string): boolean {
  if (
    /\b(most|top|biggest|largest|highest|hardest|toughest|riskiest)\b/i.test(
      lower,
    ) &&
    /\b(complex|complexity|estimate|estimates|story\s*points?|effort|task|tasks|users?[\s-]*stor(?:y|ies)|stor(?:y|ies)|implementation|implementations)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\bwhich\b/i.test(lower) &&
    /\b(task|tasks|users?[\s-]*stor(?:y|ies)|stor(?:y|ies)|issue|issues)\b/i.test(
      lower,
    ) &&
    /\b(complex|complicated|hard|tough|risky|biggest|largest|highest\s+(?:story\s*)?points?|highest\s+estimate|most\s+effort)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\bcomplex(?:ity)?\s+(?:implementation|task|users?[\s-]*stor(?:y|ies)|stor(?:y|ies)|issue|item)/i.test(
      lower,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Build a JQL clause that searches summary/description/labels for a topic.
 * Jira's `~` operator is full-text against summary/description; labels need an
 * `IN` clause. The topic is lower-cased for label matching and quote-escaped
 * for `~`.
 */
/** Issue types we allow the LLM / regex to target. */
const KNOWN_ISSUE_TYPES = [
  "Story",
  "User Story",
  "Task",
  "Sub-task",
  "Subtask",
  "Bug",
  "Epic",
] as const;
type KnownIssueType = (typeof KNOWN_ISSUE_TYPES)[number];

/**
 * Build a JQL clause that ORs every synonym across summary/description/labels.
 * Synonyms come from the LLM interpreter so we can match a single user intent
 * (e.g. "security") against the wider semantic field (auth, vulnerability,
 * encryption, ...) without any hardcoded keyword list in this file.
 */
function buildTopicJql(
  projectKey: string,
  topics: string[],
  issueTypes: string[] = [],
): string {
  const cleanTopics = topics
    .map((t) => (t || "").trim())
    .filter((t) => t.length > 0);
  if (cleanTopics.length === 0) {
    throw new Error("buildTopicJql requires at least one topic");
  }

  const safeTypes = issueTypes
    .map((t) => (t || "").trim())
    .filter((t): t is KnownIssueType =>
      (KNOWN_ISSUE_TYPES as readonly string[]).includes(t),
    );
  const typeList =
    safeTypes.length > 0
      ? safeTypes.map((t) => `"${t}"`).join(", ")
      : `"Story", "User Story"`;

  const orClauses = cleanTopics
    .map((topic) => {
      const esc = topic.replace(/"/g, '\\"');
      const labelToken = topic
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-_]/g, "");
      const labelParts = labelToken
        ? [
            `labels = "${labelToken}"`,
            `labels = "${topic.toLowerCase()}"`,
          ]
        : [];
      return [
        `summary ~ "${esc}"`,
        `description ~ "${esc}"`,
        ...labelParts,
      ].join(" OR ");
    })
    .join(" OR ");

  return (
    `project = "${projectKey}" AND issuetype in (${typeList}) ` +
    `AND (${orClauses}) ` +
    `ORDER BY updated DESC`
  );
}

/**
 * Ask the LLM to interpret a free-form Jira chat message and return a
 * structured intent + topic + synonyms. This is the dynamic, non-regex path
 * that handles natural-language variations like "userstories about security"
 * or "any auth tickets". The LLM generates the synonym list at runtime so we
 * never hardcode topic keywords in this codebase.
 */
interface JiraLLMInterpretation {
  action:
    | "semantic_search"
    | "complexity_analysis"
    | "list_epics"
    | "list_issues"
    | "list_tasks"
    | "list_subtasks"
    | "project_details"
    | "unknown";
  topic?: string;
  synonyms?: string[];
  issueTypes?: string[];
  reasoning?: string;
}

async function interpretJiraMessageWithLLM(
  message: string,
  projectKey: string,
): Promise<JiraLLMInterpretation> {
  if (!hasOpenAIConfigured()) {
    return { action: "unknown", reasoning: "LLM not configured" };
  }

  const systemPrompt =
    "You are a Jira query interpreter for a chatbot. The user is asking " +
    `about Jira project "${projectKey}". Classify their intent and extract ` +
    "structured data so the chatbot can run JQL.\n\n" +
    "Available actions:\n" +
    '- "semantic_search": user wants issues matching a TOPIC ' +
    '(e.g. "stories about security", "any auth tickets", ' +
    '"userstories related to payments")\n' +
    '- "complexity_analysis": user wants the most complex/highest-estimate ' +
    'work items (e.g. "which task is most complex", "biggest story points")\n' +
    '- "list_epics" | "list_issues" | "list_tasks" | "list_subtasks": ' +
    'simple listing requests\n' +
    '- "project_details": user wants project metadata\n' +
    '- "unknown": none of the above\n\n' +
    'For "semantic_search":\n' +
    '- topic: the canonical subject in lowercase (e.g. "security", ' +
    '"payment fraud", "accessibility")\n' +
    "- synonyms: 4-8 related keywords/phrases YOU generate to maximize " +
    "recall against Jira full-text search. Always include the topic itself. " +
    "Examples:\n" +
    '  security -> ["security","auth","authentication","vulnerability",' +
    '"encryption","csrf","xss","cve"]\n' +
    '  performance -> ["performance","latency","slow","optimization",' +
    '"throughput","memory"]\n' +
    '  payments -> ["payment","payments","billing","invoice","checkout",' +
    '"refund","stripe","paypal"]\n' +
    "- issueTypes: which Jira issue types to search. Allowed values: " +
    'Story, User Story, Task, Sub-task, Bug, Epic. If the user said ' +
    '"stories" or "userstories" use ["Story","User Story"]. If they said ' +
    '"epics" use ["Epic"]. If "tasks" use ["Task"]. If "bugs" use ["Bug"]. ' +
    'If unspecified or generic ("tickets","issues","items") use ' +
    '["Story","User Story","Task","Bug"].\n\n' +
    "Return ONLY valid JSON matching this shape:\n" +
    '{"action":"...","topic":"...","synonyms":["..."],"issueTypes":["..."],"reasoning":"..."}';

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    });
    const raw = resp.choices[0]?.message?.content?.trim();
    if (!raw) return { action: "unknown", reasoning: "Empty LLM response" };
    const parsed = JSON.parse(raw) as JiraLLMInterpretation;
    console.log(
      "[JiraAgent] LLM interpretation:",
      JSON.stringify(parsed, null, 2),
    );
    return parsed;
  } catch (err) {
    console.warn(
      "[JiraAgent] interpretJiraMessageWithLLM failed:",
      err instanceof Error ? err.message : err,
    );
    return { action: "unknown", reasoning: "LLM call failed" };
  }
}

/**
 * Use the LLM to draft a short (4-6 bullet) implementation plan for a complex
 * Jira issue. Falls back to a generic heuristic plan if OpenAI is not
 * configured or the call fails — the agent must never throw here.
 */
async function draftRemediationPlan(issue: {
  key?: string;
  title?: string;
  description?: string;
  storyPoints?: number;
  priority?: string;
}): Promise<string> {
  const fallback =
    `1. Break this work item into 2-3 smaller stories scoped to ~3 story points each.\n` +
    `2. Identify external dependencies (services, libraries, data) and confirm owners.\n` +
    `3. Draft a short technical design note and review it with the team before coding.\n` +
    `4. Add tests around the riskiest path first, then iterate.\n` +
    `5. Plan an incremental rollout (feature flag or canary) to reduce risk.`;

  if (!hasOpenAIConfigured()) return fallback;

  const desc = (issue.description || "").slice(0, 1500);
  const prompt =
    `You are a senior tech lead. Draft a concise implementation plan ` +
    `(4-6 bullet points, each <= 20 words) to break down and de-risk this Jira issue. ` +
    `Be specific to the issue content, not generic.\n\n` +
    `Issue: ${issue.key} - ${issue.title}\n` +
    `Story Points: ${issue.storyPoints ?? "unknown"}\n` +
    `Priority: ${issue.priority ?? "unknown"}\n` +
    `Description: ${desc || "(empty)"}\n\n` +
    `Return only the bullet list, numbered 1-N, no preamble.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 350,
      messages: [
        { role: "system", content: "You return concise, actionable plans." },
        { role: "user", content: prompt },
      ],
    });
    const text = resp.choices[0]?.message?.content?.trim();
    return text || fallback;
  } catch (err) {
    console.warn(
      "[JiraAgent] draftRemediationPlan LLM call failed:",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

function extractProjectKeyFromSelection(lower: string): string {
  const raw = lower
    .replace(/^use\s+jira\s+project:\s*/i, "")
    .replace(/^jira\s+project:\s*/i, "")
    .replace(/^use\s+project:\s*/i, "")
    .trim();
  // List output renders projects as "name (KEY)". When the selection arrives in
  // that form, prefer the parenthesized key so the DB lookup can match on
  // `jiraProjectKey` instead of the combined "name (KEY)" string.
  const paren = raw.match(/\(([^)]+)\)\s*$/);
  return (paren ? paren[1] : raw).trim();
}

function markdownConceptualJiraIntegration(opts?: {
  instanceUrl?: string;
  projectKey?: string;
}): string {
  const tail =
    opts?.projectKey && opts?.instanceUrl
      ? `\n\n**This Astra workspace** is linked to Jira project **${opts.projectKey}** (\`${opts.instanceUrl}\`). Use **List Jira issues** when you want a live sample.`
      : `\n\nTo **list live issues or epics**, open a Astra project linked to Jira, then use **Query Jira data** or ask to list issues here.`;
  return (
    `**Jira integration in Astra** connects an SDLC project to your **Atlassian Jira Cloud** site so backlog items, epics, and status can align with Astra workflows (requirements, design, testing, and more).\n\n` +
    `**Typical setup:** a Jira **site URL**, **project key**, and an **API token** (read/browse at minimum), configured under project or tenant settings.` +
    tail
  );
}

/** Conceptual / help questions about Jira (not live issue fetches). */
function isConceptualJiraQuestion(lower: string): boolean {
  if (!/\bjira\b/i.test(lower)) return false;
  if (/\bquery\s+jira\s+data\b/i.test(lower)) return false;
  if (/\b(list|show|get|fetch|display|count|search)\b/i.test(lower)) return false;
  if (
    /\b(what\s+is|what\s+are|how\s+does|how\s+do|explain|tell\s+me\s+about|describe|why)\b/i.test(lower)
  ) {
    if (/\b(issues?|tickets?|bugs?|stories|epics?|backlog)\b/i.test(lower)) return false;
    return true;
  }
  return false;
}

function formatWorkItemLines(
  items: Array<{ id?: string; title?: string; status?: string }>,
  limit: number,
): string {
  const slice = items.slice(0, limit);
  if (slice.length === 0) {
    return "_No items returned._";
  }
  return slice
    .map((w, i) => {
      const label = w.id || w.title || `Item ${i + 1}`;
      const st = w.status ? ` — _${w.status}_` : "";
      return `${i + 1}. **${label}**${w.title && w.id !== w.title ? ` — ${w.title}` : ""}${st}`;
    })
    .join("\n");
}

/**
 * Probe the project for any issue (regardless of issuetype) so we can craft
 * a useful empty-state message — distinguishing "project is empty" from
 * "project has issues, but none of the requested type".
 */
async function buildEmptyStateMessage(
  service: import("../../integrations/jira/jira-service").JiraService,
  projectKey: string,
  requestedLabel: string,
  alternativeChips: string[],
): Promise<string> {
  let totalIssues = 0;
  const sampleTypes = new Set<string>();
  try {
    const probe = await service.searchIssuesByJql(
      `project = "${projectKey}" ORDER BY created DESC`,
      10,
    );
    totalIssues = probe.length;
    for (const it of probe) {
      const t = (it as { type?: string }).type;
      if (t) sampleTypes.add(t);
    }
  } catch (err) {
    console.warn(
      "[JiraAgent] Empty-state probe failed:",
      err instanceof Error ? err.message : err,
    );
  }

  if (totalIssues === 0) {
    return (
      `Project **${projectKey}** has **no issues** in Jira yet — there are no epics, tasks, stories, or subtasks to show.\n\n` +
      `Create some issues in Jira (or import a backlog) and try again, or pick a different project from **List Jira projects**. ` +
      `To find which of your projects already have content, ask **Find projects with issues**.`
    );
  }

  const typesLine =
    sampleTypes.size > 0
      ? `Issue types currently in **${projectKey}**: ${Array.from(sampleTypes)
          .map((t) => `\`${t}\``)
          .join(", ")}.`
      : "";

  return (
    `Project **${projectKey}** has issues but **no ${requestedLabel}** were found.\n\n` +
    (typesLine ? `${typesLine}\n\n` : "") +
    `Try one of: ${alternativeChips.map((c) => `**${c}**`).join(", ")}. ` +
    `Or ask **Find projects with issues** to see which of your Jira projects have content.`
  );
}

export const jiraAgent: Agent = {
  name: "Jira Agent",
  description:
    "Helps users explore Jira issues, epics, and project integration settings in Astra.",

  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const lower = message.toLowerCase();
    const projectId = resolveProjectId(context);
    const platforms = getAllowedWorkItemPlatforms();
    const adoOn = platforms.includes("ado");
    const jiraOn = platforms.includes("jira");
    const baseQuickReplies = buildNavQuickReplies(adoOn, jiraOn);

    // Allow selecting a Jira project from chips even without an active Astra project in context.
    if (isSelectJiraProjectIntent(lower)) {
      const projectKeyOrName = extractProjectKeyFromSelection(lower);
      if (!projectKeyOrName) {
        return {
          reply: applySummaryPrefix(
            `Please provide a Jira project key or name (example: **ASTRA**).`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: ["List Jira projects", ...baseQuickReplies] },
        };
      }

      // Try to resolve a Astra SDLC project row for this Jira project.
      const normalized = projectKeyOrName.toUpperCase();
      const selectedOrgName = context.selectedOrganization?.name?.toLowerCase();
      const orgs = await listTenantJiraConnections(context.userId);
      const matchedOrg = selectedOrgName
        ? orgs.find((o) => o.name.toLowerCase() === selectedOrgName)
        : null;
      const jiraConnectionId = matchedOrg?.id ?? null;

      const [row] = await db
        .select({
          id: schema.sdlcProjects.id,
          name: schema.sdlcProjects.name,
          jiraProjectKey: schema.sdlcProjects.jiraProjectKey,
          jiraConnectionId: schema.sdlcProjects.jiraConnectionId,
        })
        .from(schema.sdlcProjects)
        .where(
          jiraConnectionId
            ? and(
                eq(schema.sdlcProjects.integrationType, "jira"),
                eq(schema.sdlcProjects.jiraConnectionId, jiraConnectionId),
                or(
                  sql`lower(${schema.sdlcProjects.jiraProjectKey}) = lower(${normalized})`,
                  sql`lower(${schema.sdlcProjects.name}) = lower(${projectKeyOrName})`,
                ),
              )
            : and(
                eq(schema.sdlcProjects.integrationType, "jira"),
                or(
                  sql`lower(${schema.sdlcProjects.jiraProjectKey}) = lower(${normalized})`,
                  sql`lower(${schema.sdlcProjects.name}) = lower(${projectKeyOrName})`,
                ),
              ),
        )
        .limit(1);

      if (!row?.id) {
        return {
          reply: applySummaryPrefix(
            `I found the Jira project **${projectKeyOrName}**, but it is not linked to a Astra SDLC project yet.\n\n` +
              `Create/sync it under **Projects** (Jira) so Astra stores its configuration, then try again.`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: ["List Jira projects", "Go to Settings", ...baseQuickReplies] },
        };
      }

      context.selectedProject = { id: row.id, name: row.name || projectKeyOrName };
      // Persist this choice across turns. The chat route overwrites
      // `selectedProject` on every request from the client's sessionStorage,
      // so we mirror the selection into `agentSelectedProject` which the
      // route handler does not touch — `resolveProjectId` prefers this field.
      context.agentSelectedProject = {
        id: row.id,
        name: row.name || projectKeyOrName,
      };

      // Immediately fetch epics + user stories so the user gets the data in
      // one click, instead of just a "Selected." stub.
      const selectedReplyChips = [
        "Show Jira epics",
        "List Jira issues",
        "Find stories related to security",
        "Which tasks are most complex?",
        "List Jira tasks",
        "List Jira subtasks",
        "Jira project details",
        "Find projects with issues",
        "Go to Settings",
      ];

      const cfg = await getJiraConfig(row.id);
      if (!cfg) {
        return {
          reply: applySummaryPrefix(
            `Selected Astra project **${context.selectedProject.name}** for Jira project **${projectKeyOrName}**, ` +
              `but I could not load its Jira credentials. Open **Settings** to configure them.`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: ["Go to Settings", ...selectedReplyChips] },
        };
      }

      let projectService: JiraService;
      try {
        projectService = new JiraService({
          instanceUrl: cfg.instanceUrl,
          projectKey: cfg.projectKey,
          email: cfg.email,
          apiToken: cfg.apiToken,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          reply: applySummaryPrefix(
            `Selected **${context.selectedProject.name}**, but Jira credentials look invalid: **${msg}**. Update them in **Settings** and try again.`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: ["Go to Settings", ...selectedReplyChips] },
        };
      }

      // Fetch epics (with built-in fallback chain) and a sample of stories
      // in parallel. Either or both may be empty for sandbox projects.
      const [epicsResult, storiesResult] = await Promise.allSettled([
        projectService.getEpics(),
        projectService.searchIssuesByJql(
          `project = "${cfg.projectKey}" AND issuetype in (Story, "User Story") ORDER BY created DESC`,
          10,
        ),
      ]);

      const epics =
        epicsResult.status === "fulfilled" ? epicsResult.value : [];
      const stories =
        storiesResult.status === "fulfilled" ? storiesResult.value : [];

      if (epicsResult.status === "rejected") {
        console.warn(
          "[JiraAgent] getEpics failed for selected project:",
          epicsResult.reason instanceof Error
            ? epicsResult.reason.message
            : epicsResult.reason,
        );
      }
      if (storiesResult.status === "rejected") {
        console.warn(
          "[JiraAgent] story search failed for selected project:",
          storiesResult.reason instanceof Error
            ? storiesResult.reason.message
            : storiesResult.reason,
        );
      }

      const sections: string[] = [
        `Selected Astra project **${context.selectedProject.name}** (Jira project **${cfg.projectKey}**).`,
      ];

      if (epics.length > 0) {
        sections.push(
          `\n**Epics / high-level items** (showing up to 10):\n\n${formatProjectLines(
            epics.map((e) => ({ key: e.id, name: e.title })),
            10,
          )}`,
        );
      } else {
        sections.push(
          `\n_No Epic-level items found in **${cfg.projectKey}**._`,
        );
      }

      if (stories.length > 0) {
        sections.push(
          `\n**User stories** (showing up to 10):\n\n${formatWorkItemLines(
            stories.map((s) => ({
              id: s.key || s.id,
              title: s.title,
              status: s.status,
            })),
            10,
          )}`,
        );
      } else {
        sections.push(
          `\n_No User Story-type issues found in **${cfg.projectKey}**._`,
        );
      }

      // If both came back empty, attach the same probe-based explanation
      // we use elsewhere so the user knows whether the project is empty or
      // just missing those types.
      if (epics.length === 0 && stories.length === 0) {
        const explanation = await buildEmptyStateMessage(
          projectService,
          cfg.projectKey,
          "Epics or User Stories",
          ["List Jira issues", "List Jira tasks", "List Jira subtasks"],
        );
        sections.push(`\n${explanation}`);
      } else {
        sections.push(
          `\n_Use the chips below to drill into more detail._`,
        );
      }

      return {
        reply: applySummaryPrefix(sections.join("\n"), context),
        usedAgent: "jira",
        metadata: { quickReplies: selectedReplyChips },
      };
    }

    if (isJiraOrgListingIntent(lower)) {
      const orgs = await listTenantJiraConnections(context.userId);
      if (orgs.length === 0) {
        return {
          reply: applySummaryPrefix(
            `I did not find any **active Jira connections** registered in this Astra environment yet.\n\n` +
              `Add one under **Settings** (integrations): give the connection a **name**, your Jira **site URL**, and an **API token**.\n\n` +
              `That list is what you see as **Jira organizations** in the product; linking a **Astra project** to Jira is a separate step per project.`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "View my settings",
              "Go to Settings",
              ...(adoOn ? (["Query ADO data"] as const) : []),
              ...(jiraOn ? (["Query Jira data"] as const) : []),
              "What is Jira integration?",
            ],
          },
        };
      }
      const lines = orgs
        .map(
          (o, i) =>
            `${i + 1}. **${o.name}** — \`${o.instanceUrl.replace(/\/+$/, "")}\``,
        )
        .join("\n");
      return {
        reply: applySummaryPrefix(
          `Here are the **Jira connections** (organizations / sites) available in Astra:\n\n${lines}\n\n` +
            `Pick an organization from the chips below to see its projects, or open **Settings** to add/edit a connection.`,
          context,
        ),
        usedAgent: "jira",
        metadata: {
          quickReplies: [
            ...orgs
              .slice(0, MAX_ORG_CHIPS)
              .map((o) => `List projects in ${o.name}`),
            "Find projects with issues",
            "Go to Settings",
          ],
        },
      };
    }

    // "Find projects with issues / epics / tasks" — scan all visible projects
    // on the active connection and report which contain content.
    if (isFindProjectsWithContentIntent(lower)) {
      const filterMatch = lower.match(
        /\b(epics?|issues?|tasks?|sub-?tasks?|stories|bugs?)\b/i,
      );
      const rawFilter = filterMatch?.[1]?.toLowerCase() ?? "issue";
      const filterLabel = rawFilter.replace(/s$/, ""); // singular for display

      // Resolve which Jira credentials to use.
      let jiraConn:
        | {
            instanceUrl: string;
            email: string | null;
            apiToken: string;
            connectionName: string;
          }
        | null = null;

      if (projectId) {
        const cfg = await getJiraConfig(projectId);
        if (cfg) {
          jiraConn = {
            instanceUrl: cfg.instanceUrl,
            email: cfg.email,
            apiToken: cfg.apiToken,
            connectionName: context.selectedOrganization?.name ?? cfg.instanceUrl,
          };
        }
      }

      if (!jiraConn) {
        const orgs = await listTenantJiraConnections(context.userId);
        if (orgs.length === 0) {
          return {
            reply: applySummaryPrefix(
              `I don't have any active Jira connections to scan. Add one under **Settings** first.`,
              context,
            ),
            usedAgent: "jira",
            metadata: { quickReplies: ["Go to Settings", ...buildNoProjectHelpChips(adoOn, jiraOn)] },
          };
        }
        // Use the most recently updated connection by default.
        const target = orgs[0];
        const [conn] = await db
          .select({
            instanceUrl: jiraConnections.instanceUrl,
            email: jiraConnections.email,
            apiTokenEncrypted: jiraConnections.apiTokenEncrypted,
            name: jiraConnections.name,
          })
          .from(jiraConnections)
          .where(eq(jiraConnections.id, target.id))
          .limit(1);
        if (!conn?.apiTokenEncrypted || !conn?.email) {
          return {
            reply: applySummaryPrefix(
              `Jira connection **${target.name}** is missing credentials. Update it under **Settings** and try again.`,
              context,
            ),
            usedAgent: "jira",
            metadata: { quickReplies: ["Go to Settings", ...buildNoProjectHelpChips(adoOn, jiraOn)] },
          };
        }
        jiraConn = {
          instanceUrl: conn.instanceUrl,
          email: conn.email,
          apiToken: decryptJiraToken(conn.apiTokenEncrypted),
          connectionName: conn.name || target.name,
        };
      }

      const scanService = new JiraService({
        instanceUrl: jiraConn.instanceUrl,
        email: jiraConn.email ?? "",
        apiToken: jiraConn.apiToken,
      });

      let projects: Array<{ key?: string; name?: string }> = [];
      try {
        projects = await scanService.getProjects();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          reply: applySummaryPrefix(
            `I could not load projects from Jira: **${msg}**`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: ["Go to Settings", ...buildNoProjectHelpChips(adoOn, jiraOn)] },
        };
      }

      // Cap the scan to keep latency bounded.
      const SCAN_CAP = 20;
      const scanList = projects
        .filter((p) => typeof p.key === "string" && p.key.trim())
        .slice(0, SCAN_CAP);

      // Build issue-type filter clause.
      const typeClause = (() => {
        switch (filterLabel) {
          case "epic":
            return "AND issuetype = Epic";
          case "task":
            return "AND issuetype = Task";
          case "subtask":
          case "sub-task":
            return 'AND issuetype in ("Sub-task","Subtask")';
          case "story":
            return "AND issuetype = Story";
          case "bug":
            return "AND issuetype = Bug";
          case "issue":
          case "ticket":
          default:
            return "";
        }
      })();

      const scanResults = await Promise.all(
        scanList.map(async (p) => {
          const key = (p.key as string).trim();
          try {
            const probe = await scanService.searchIssuesByJql(
              `project = "${key}" ${typeClause} ORDER BY created DESC`.replace(
                /\s+/g,
                " ",
              ),
              5,
            );
            const types = Array.from(
              new Set(probe.map((it) => it.type).filter((x): x is string => Boolean(x))),
            );
            return { key, name: p.name ?? key, count: probe.length, types };
          } catch (err) {
            console.warn(
              `[JiraAgent] scan probe for "${key}" failed:`,
              err instanceof Error ? err.message : err,
            );
            return { key, name: p.name ?? key, count: 0, types: [] as string[], error: true };
          }
        }),
      );

      const withContent = scanResults.filter((r) => r.count > 0);
      const withoutContent = scanResults.filter((r) => r.count === 0);

      const headerLabel =
        filterLabel === "issue" || filterLabel === "ticket"
          ? "any issues"
          : `**${filterLabel}**-type items`;

      const linesWith =
        withContent.length === 0
          ? `_None of the ${scanList.length} scanned projects contain ${headerLabel}._`
          : withContent
              .map((r, i) => {
                const types = r.types.length ? ` _(${r.types.join(", ")})_` : "";
                const moreSuffix = r.count >= 5 ? "+" : "";
                return `${i + 1}. **${r.name}** (${r.key}) — ${r.count}${moreSuffix} match${r.count === 1 ? "" : "es"}${types}`;
              })
              .join("\n");

      const emptySummary =
        withoutContent.length > 0
          ? `\n\n_${withoutContent.length} other project${
              withoutContent.length === 1 ? "" : "s"
            } scanned had no ${headerLabel}: ${withoutContent
              .slice(0, 8)
              .map((r) => r.key)
              .join(", ")}${withoutContent.length > 8 ? "…" : ""}._`
          : "";

      const totalNote =
        projects.length > scanList.length
          ? `\n\n_Showing the first ${scanList.length} of ${projects.length} projects on **${jiraConn.connectionName}**. Re-run with a project key for full details._`
          : `\n\n_Scanned all ${scanList.length} projects on **${jiraConn.connectionName}**._`;

      const chips = [
        ...withContent
          .slice(0, 3)
          .map((r) => `Use Jira project: ${r.key}`),
        "List Jira projects",
        "Show Jira epics",
        "List Jira issues",
        "Go to Settings",
      ];

      return {
        reply: applySummaryPrefix(
          `**Projects on ${jiraConn.connectionName} that contain ${headerLabel}:**\n\n${linesWith}${emptySummary}${totalNote}`,
          context,
        ),
        usedAgent: "jira",
        metadata: { quickReplies: chips },
      };
    }

    // "Show Jira projects" / "List Jira projects"
    if (isJiraProjectsIntent(lower)) {
      const orgs = await listTenantJiraConnections(context.userId);
      if (orgs.length === 0) {
        return {
          reply: applySummaryPrefix(
            `I did not find any **active Jira connections** registered in this Astra environment yet.\n\n` +
              `Add one under **Settings** (integrations): connection name, site URL, and an API token.`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: ["Go to Settings", ...buildNoProjectHelpChips(adoOn, jiraOn)] },
        };
      }

      // Normalize common quick-reply prefixes for matching.
      const normalizedLower = lower
        .replace(/^use\s+jira\s+org:\s*/i, "")
        .replace(/^list\s+projects\s+in\s*/i, "")
        .trim();

      // Detect explicit "projects in <org>" phrasing so we avoid silently
      // falling back to an unrelated active project connection.
      const explicitOrgToken = (() => {
        const match = message.match(/\bprojects?\s+in\s+(.+)$/i);
        if (!match?.[1]) return "";
        return match[1]
          .replace(/\s+organization\b/i, "")
          .trim()
          .toLowerCase();
      })();
      const hasExplicitOrgRequest = explicitOrgToken.length > 0;

      // 1. Try to match a connection from the message (exact, then substring).
      // 2. If no match, fall back to the active Astra project's connection.
      // 3. If still no resolution, prompt the user to pick one.
      let matched =
        orgs.find((o) => o.name.toLowerCase() === explicitOrgToken || o.name.toLowerCase() === normalizedLower) ??
        orgs.find(
          (o) =>
            o.instanceUrl.replace(/\/+$/, "").toLowerCase() ===
            (explicitOrgToken || normalizedLower),
        ) ??
        orgs.find((o) => {
          const name = o.name.toLowerCase();
          const url = o.instanceUrl.replace(/\/+$/, "").toLowerCase();
          const probe = explicitOrgToken || normalizedLower;
          return (
            probe.includes(name) ||
            probe.includes(url) ||
            name.includes(probe)
          );
        });

      if (!matched && !hasExplicitOrgRequest && projectId) {
        // No connection named explicitly — use the active project's connection
        // so the same code path still applies the linkedKeys filter.
        try {
          const [row] = await db
            .select({ jiraConnectionId: schema.sdlcProjects.jiraConnectionId })
            .from(schema.sdlcProjects)
            .where(eq(schema.sdlcProjects.id, projectId))
            .limit(1);
          if (row?.jiraConnectionId) {
            matched = orgs.find((o) => o.id === row.jiraConnectionId);
          }
        } catch (err) {
          console.error(
            "[JiraAgent] Failed to resolve active project's Jira connection:",
            err,
          );
        }
      }

      if (!matched) {
        const lines = orgs
          .slice(0, MAX_ORGS_IN_PROMPT)
          .map((o, i) => `${i + 1}. **${o.name}** — \`${o.instanceUrl.replace(/\/+$/, "")}\``)
          .join("\n");
        return {
          reply: applySummaryPrefix(
            `Which Jira connection should I use to list projects?\n\n${lines}\n\n` +
              `Reply with the **connection name** (example: **${orgs[0].name}**)`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: orgs
              .slice(0, MAX_ORG_CHIPS)
              .map((o) => `List projects in ${o.name}`),
          },
        };
      }

      const [conn] = await db
        .select({
          instanceUrl: jiraConnections.instanceUrl,
          email: jiraConnections.email,
          apiTokenEncrypted: jiraConnections.apiTokenEncrypted,
        })
        .from(jiraConnections)
        .where(eq(jiraConnections.id, matched.id))
        .limit(1);

      // Load Astra SDLC projects that are actually linked to THIS Jira
      // connection. Multiple connections may share the same Atlassian site,
      // so we cannot rely on Jira's `/project/search` alone — it returns
      // every project visible to the API token, which causes "same list for
      // every organization". Intersecting with `sdlcProjects` makes the
      // result connection-scoped and meaningful inside Astra.
      let linkedKeys: Set<string> = new Set();
      let linkedIds: Set<string> = new Set();
      try {
        const normalizedConnectionUrl = matched.instanceUrl.replace(/\/+$/, "").toLowerCase();
        const allJiraConnections = await db.select({ instanceUrl: jiraConnections.instanceUrl }).from(jiraConnections);
        const allowLegacyUrlFallback =
          allJiraConnections.filter((candidate) =>
            candidate.instanceUrl.replace(/\/+$/, "").toLowerCase() === normalizedConnectionUrl,
          ).length <= 1;

        const linked = await db
          .select({
            key: schema.sdlcProjects.jiraProjectKey,
            id: schema.sdlcProjects.projectId,
            jiraInstanceUrl: schema.sdlcProjects.jiraInstanceUrl,
            organization: schema.sdlcProjects.organization,
            jiraConnectionId: schema.sdlcProjects.jiraConnectionId,
          })
          .from(schema.sdlcProjects)
          .where(
            and(
              eq(schema.sdlcProjects.integrationType, "jira"),
              or(
                eq(schema.sdlcProjects.jiraConnectionId, matched.id),
                ...(allowLegacyUrlFallback
                  ? [
                      and(
                        sql`${schema.sdlcProjects.jiraConnectionId} IS NULL`,
                        or(
                          sql`LOWER(TRIM(TRAILING '/' FROM ${schema.sdlcProjects.jiraInstanceUrl})) = ${normalizedConnectionUrl}`,
                          sql`LOWER(TRIM(TRAILING '/' FROM ${schema.sdlcProjects.organization})) = ${normalizedConnectionUrl}`,
                        ),
                      )!,
                    ]
                  : []),
              ),
            ),
          );

        linkedKeys = new Set(
          linked
            .map((r) => (r.key || "").trim().toUpperCase())
            .filter((k) => k.length > 0),
        );

        linkedIds = new Set(
          linked
            .map((r) => (r.id || "").trim().toUpperCase())
            .filter((id) => id.length > 0),
        );
      } catch (err) {
        console.error(
          "[JiraAgent] Failed to load linked SDLC projects for connection:",
          err,
        );
      }

      let jiraService: JiraService | null = null;
      let credentialMode: "user" | "shared" = "shared";

      if (context.userId) {
        try {
          jiraService = await getJiraServiceForUser(
            context.userId,
            undefined,
            conn?.instanceUrl || matched.instanceUrl,
          );
          credentialMode = "user";
        } catch (err) {
          if (
            err instanceof UserJiraCredentialMissingError ||
            err instanceof UserJiraCredentialInvalidError
          ) {
            console.log(
              `[JiraAgent] Per-user Jira credential unavailable/invalid for user ${context.userId}; falling back to shared Jira connection for project listing.`,
            );
          } else {
            console.warn("[JiraAgent] Per-user Jira credential resolution failed:", err);
          }
        }
      }

      if (!jiraService) {
        if (!conn?.apiTokenEncrypted || !conn?.email) {
          return {
            reply: applySummaryPrefix(
              `That Jira connection is missing credentials (email and/or API token), and no active user Jira credential was found. Please update it under **Settings**.`,
              context,
            ),
            usedAgent: "jira",
            metadata: { quickReplies: ["Go to Settings", ...buildNoProjectHelpChips(adoOn, jiraOn)] },
          };
        }

        jiraService = new JiraService({
          instanceUrl: conn.instanceUrl,
          email: conn.email,
          apiToken: decryptJiraToken(conn.apiTokenEncrypted),
        });
      }

      const allProjects = await jiraService.getProjects();

      if (allProjects.length === 0) {
        let diagnostic = "Jira returned no projects visible to the current credentials.";
        try {
          const test = await jiraService.testConnection();
          diagnostic = test.message || diagnostic;
        } catch {
          // Keep default diagnostic if probe fails.
        }

        return {
          reply: applySummaryPrefix(
            `I reached Jira for **${matched.name}**, but no projects were returned.\n\n` +
              `**Live diagnostic:** ${diagnostic}\n\n` +
              `**Credential mode used:** ${credentialMode === "user" ? "Per-user Jira credential" : "Shared connection credential"}.\n\n` +
              `Most common causes:\n` +
              `- This account/token does not have **Browse projects** permission\n` +
              `- The token belongs to a different Jira user than expected\n` +
              `- The Jira site is correct, but no projects are visible to this account`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "Go to Settings",
              `List projects in ${matched.name}`,
              "Show me the Jira organizations",
              "What is Jira integration?",
            ],
          },
        };
      }

      const scopedProjects = linkedKeys.size || linkedIds.size
        ? allProjects.filter((p) => {
            const key = (p.key || "").trim().toUpperCase();
            const id = (p.id || "").trim().toUpperCase();
            return (key && linkedKeys.has(key)) || (id && linkedIds.has(id));
          })
        : [];

      // Keep response connection-scoped. If we have scoped Astra-linked/legacy
      // projects, show only those; otherwise show all visible as fallback.
      const projects = scopedProjects.length > 0 ? scopedProjects : allProjects;

      const linkedCount = scopedProjects.length;
      const totalCount = projects.length;
      const cleanInstance = (conn.instanceUrl || matched.instanceUrl).replace(
        /\/+$/,
        "",
      );

      console.log(
        `[JiraAgent] Project list for ${matched.name}: totalVisible=${allProjects.length}, scoped=${linkedCount}, displayed=${totalCount}`,
      );

      const heading = linkedCount > 0
        ? `Here are Jira projects for **${matched.name}** at \`${cleanInstance}\` (showing up to **20**). Linked in Astra: **${linkedCount}** of **${allProjects.length}** visible.`
        : `No Astra projects are linked to **${matched.name}** yet, so here are all Jira projects visible to that connection's API token at \`${cleanInstance}\` (showing up to **20**):`;

      return {
        reply: applySummaryPrefix(
          `${heading}\n\n` + formatProjectLines(projects, 20),
          context,
        ),
        usedAgent: "jira",
        metadata: {
          quickReplies: [
            ...projects
              .filter((p) => typeof p.key === "string" && p.key.trim())
              .slice(0, 3)
              .map((p) => `Use Jira project: ${(p.key as string).trim()}`),
            "Jira project details",
            "List Jira issues",
            "Show Jira epics",
            "Go to Settings",
          ],
        },
      };
    }

    if (!projectId) {
      if (isConceptualJiraQuestion(lower)) {
        return {
          reply: applySummaryPrefix(markdownConceptualJiraIntegration(), context),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "View my settings",
              "Ask about Astra features",
              ...(adoOn ? (["Query ADO data"] as const) : []),
              ...(jiraOn ? (["Query Jira data"] as const) : []),
              "Show golden repos",
            ],
          },
        };
      }

      return {
        reply: applySummaryPrefix(
          `I'd love to help with **live Jira data**, but I need an **active Astra project** in context first.\n\n` +
            `Open a project in Astra (from Overview or your workspace), then use **Query Jira data** again. ` +
            `Configure Jira under **Settings** for that project: site URL, email, and API token.\n\n` +
            `To see **Jira organizations** (connections) without a project, ask **"Show me the Jira organizations"**. ` +
            `For **what Jira integration means**, ask **What is Jira integration?**`,
          context,
        ),
        usedAgent: "jira",
        metadata: {
          quickReplies: buildNoProjectHelpChips(adoOn, jiraOn),
        },
      };
    }

    let jiraConfig: Awaited<ReturnType<typeof getJiraConfig>>;
    try {
      jiraConfig = await getJiraConfig(projectId);
    } catch (e) {
      console.error("[JiraAgent] getJiraConfig error:", e);
      jiraConfig = null;
    }

    if (!jiraConfig) {
      return {
        reply: applySummaryPrefix(
          `I don't see a **Jira** connection for this project yet.\n\n` +
            `**To get started:**\n` +
            `1. Open **Settings** (or your project's integration settings).\n` +
            `2. Connect your Jira **site URL**, **project key**, and an **API token** (with browse/read access).\n` +
            `3. Ensure this Astra project uses **Jira** as its work-item integration.\n\n` +
            `After setup, come back here and try **"List Jira issues"** or **"Show Jira epics"**.`,
          context,
        ),
        usedAgent: "jira",
        metadata: {
          quickReplies: [
            "Go to Settings",
            "Jira project details",
            "Ask about Astra features",
            ...(adoOn ? (["Query ADO data"] as const) : []),
            ...(jiraOn ? (["Query Jira data"] as const) : []),
          ],
        },
      };
    }

    let service: JiraService;
    try {
      service = new JiraService({
        instanceUrl: jiraConfig.instanceUrl,
        projectKey: jiraConfig.projectKey,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        reply: applySummaryPrefix(
          `Your Jira credentials look incomplete or invalid (**${msg}**). Please update them in Settings and try again.`,
          context,
        ),
        usedAgent: "jira",
        metadata: {
          quickReplies: ["Go to Settings", "Jira project details", ...buildNavQuickReplies(adoOn, jiraOn).slice(2)],
        },
      };
    }

    if (isConceptualJiraQuestion(lower)) {
      return {
        reply: applySummaryPrefix(
          markdownConceptualJiraIntegration({
            instanceUrl: jiraConfig.instanceUrl,
            projectKey: jiraConfig.projectKey,
          }),
          context,
        ),
        usedAgent: "jira",
        metadata: { quickReplies: baseQuickReplies },
      };
    }

    // Default welcome / capabilities
    if (
      /^help$/i.test(message.trim()) ||
      /\b(what can you|capabilities|hello|hi)\b/i.test(lower)
    ) {
      return {
        reply: applySummaryPrefix(
          `**Jira Agent** — here's what I can help with for project **${jiraConfig.projectKey}**:\n\n` +
            `- **Issues & tickets** — fetch a sample of stories, tasks, and bugs from your Jira project\n` +
            `- **Epics** — list epic-level work (or top-level tasks when epics are not configured)\n` +
            `- **Project context** — confirm instance URL and project key\n\n` +
            `Tell me what you would like to see, or use a quick action below.`,
          context,
        ),
        usedAgent: "jira",
        metadata: { quickReplies: baseQuickReplies },
      };
    }

    if (isProjectDetailsIntent(lower)) {
      // Enrich with the Astra SDLC row + linked Jira connection so the user can
      // see the Astra project id, the Jira project key, and which Jira
      // organization (connection) it is bound to.
      let sdlcRow:
        | {
            id: string;
            name: string | null;
            jiraProjectKey: string | null;
            jiraConnectionId: string | null;
            jiraInstanceUrl: string | null;
            integrationType: string | null;
          }
        | undefined;
      try {
        const [row] = await db
          .select({
            id: schema.sdlcProjects.id,
            name: schema.sdlcProjects.name,
            jiraProjectKey: schema.sdlcProjects.jiraProjectKey,
            jiraConnectionId: schema.sdlcProjects.jiraConnectionId,
            jiraInstanceUrl: schema.sdlcProjects.jiraInstanceUrl,
            integrationType: schema.sdlcProjects.integrationType,
          })
          .from(schema.sdlcProjects)
          .where(eq(schema.sdlcProjects.id, projectId))
          .limit(1);
        sdlcRow = row;
      } catch (err) {
        console.error("[JiraAgent] Failed to load SDLC project for details:", err);
      }

      let connectionRow:
        | { id: string; name: string | null; instanceUrl: string | null }
        | undefined;
      if (sdlcRow?.jiraConnectionId) {
        try {
          const [conn] = await db
            .select({
              id: jiraConnections.id,
              name: jiraConnections.name,
              instanceUrl: jiraConnections.instanceUrl,
            })
            .from(jiraConnections)
            .where(eq(jiraConnections.id, sdlcRow.jiraConnectionId))
            .limit(1);
          connectionRow = conn;
        } catch (err) {
          console.error("[JiraAgent] Failed to load Jira connection for details:", err);
        }
      }

      const devxProjectName =
        sdlcRow?.name || context.selectedProject?.name || "Selected project";
      const devxProjectId = sdlcRow?.id || projectId;
      const integrationLabel = sdlcRow?.integrationType || "jira";
      const orgName = connectionRow?.name || context.selectedOrganization?.name;
      const orgInstance =
        connectionRow?.instanceUrl ||
        sdlcRow?.jiraInstanceUrl ||
        jiraConfig.instanceUrl;
      const orgId = connectionRow?.id || sdlcRow?.jiraConnectionId;

      const lines: string[] = [
        `**Jira project (Astra context)**`,
        ``,
        `- **Astra project:** ${devxProjectName}`,
        `- **Astra project ID:** \`${devxProjectId}\``,
        `- **Integration type:** ${integrationLabel}`,
        `- **Jira project key:** ${jiraConfig.projectKey}`,
      ];

      if (sdlcRow?.jiraProjectKey && sdlcRow.jiraProjectKey !== jiraConfig.projectKey) {
        lines.push(`- **Stored Jira project key (Astra):** ${sdlcRow.jiraProjectKey}`);
      }

      if (orgName || orgInstance) {
        lines.push(``);
        lines.push(`**Jira organization (connection):**`);
        if (orgName) lines.push(`- **Name:** ${orgName}`);
        if (orgId) lines.push(`- **Connection ID:** \`${orgId}\``);
        if (orgInstance) lines.push(`- **Instance URL:** ${orgInstance.replace(/\/+$/, "")}`);
      } else {
        lines.push(``);
        lines.push(
          `_No Jira connection / organization is linked to this Astra project — only project-level Jira settings are configured._`,
        );
      }

      lines.push(``);
      lines.push(
        `Use **List Jira issues** or **Show Jira epics** to pull live data from Jira.`,
      );

      return {
        reply: applySummaryPrefix(lines.join("\n"), context),
        usedAgent: "jira",
        metadata: { quickReplies: baseQuickReplies },
      };
    }

    if (isSemanticStoryIntent(lower)) {
      const topic = extractSemanticTopic(message);
      if (!topic) {
        return {
          reply: applySummaryPrefix(
            `Tell me which topic to search for. For example: **Find stories related to security** or **Find stories related to payments**.`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "Find stories related to security",
              "Find stories related to payments",
              "Find stories related to onboarding",
              "List Jira issues",
              "Show Jira epics",
              "Go to Settings",
            ],
          },
        };
      }

      try {
        const jql = buildTopicJql(jiraConfig.projectKey, [topic]);
        console.log(`[JiraAgent] Semantic search JQL: ${jql}`);
        const matches = await service.searchIssuesRich(jql, 25);

        if (matches.length === 0) {
          return {
            reply: applySummaryPrefix(
              `I did not find any **User Stories** in **${jiraConfig.projectKey}** matching **"${topic}"** ` +
                `(searched summary, description, and labels).\n\n` +
                `Try a related keyword, or use **List Jira issues** to browse what's in the backlog.`,
              context,
            ),
            usedAgent: "jira",
            metadata: {
              quickReplies: [
                "List Jira issues",
                "Show Jira epics",
                "Which tasks are most complex?",
                "Find projects with issues",
                "Jira project details",
                "Go to Settings",
              ],
            },
          };
        }

        const lines = matches
          .slice(0, 15)
          .map((m, i) => {
            const status = m.status ? ` — _${m.status}_` : "";
            const priority = m.priority ? ` · priority: **${m.priority}**` : "";
            const labels =
              m.labels && m.labels.length
                ? ` · labels: ${m.labels
                    .slice(0, 4)
                    .map((l) => `\`${l}\``)
                    .join(", ")}`
                : "";
            return `${i + 1}. **${m.key}** — ${m.title || "(no title)"}${status}${priority}${labels}`;
          })
          .join("\n");

        const overflow =
          matches.length > 15
            ? `\n\n_Showing 15 of ${matches.length} matches. Refine the topic for a tighter list._`
            : "";

        return {
          reply: applySummaryPrefix(
            `Here are **${Math.min(matches.length, 15)}** user stor${
              matches.length === 1 ? "y" : "ies"
            } in **${jiraConfig.projectKey}** related to **"${topic}"**:\n\n` +
              lines +
              overflow,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              `Which tasks are most complex?`,
              "Show Jira epics",
              "List Jira issues",
              "Find projects with issues",
              "Jira project details",
              "Go to Settings",
            ],
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          reply: applySummaryPrefix(
            `I could not run the semantic search on Jira: **${msg}**`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: baseQuickReplies },
        };
      }
    }

    if (isComplexityIntent(lower)) {
      try {
        // Pull all open issues (Story/Task/Bug) with their story points so we
        // can sort by estimate in JS — JQL ORDER BY on a custom field works,
        // but `customfield_xxxxx` ids vary by instance and we already cache
        // the resolved id inside searchIssuesRich via getFieldMapping.
        const jql =
          `project = "${jiraConfig.projectKey}" ` +
          `AND issuetype in (Story, "User Story", Task, Bug) ` +
          `AND statusCategory != Done ` +
          `ORDER BY updated DESC`;
        const issues = await service.searchIssuesRich(jql, 75);

        const scored = issues
          .map((i) => {
            // Complexity score = story points (primary) with a small bonus
            // for long descriptions when points are missing/zero, so projects
            // that don't estimate still get a meaningful ranking.
            const points = i.storyPoints ?? 0;
            const descBonus = Math.min(
              5,
              Math.floor((i.description?.length || 0) / 400),
            );
            const score = points > 0 ? points : descBonus;
            return { ...i, _score: score };
          })
          .filter((i) => i._score > 0)
          .sort((a, b) => b._score - a._score);

        if (scored.length === 0) {
          return {
            reply: applySummaryPrefix(
              `I could not find any open work items in **${jiraConfig.projectKey}** with story points or substantive descriptions. ` +
                `Add **Story Points** estimates in Jira (or open issues with descriptions) and try again.`,
              context,
            ),
            usedAgent: "jira",
            metadata: {
              quickReplies: [
                "List Jira issues",
                "Show Jira epics",
                "Find stories related to security",
                "Jira project details",
                "Go to Settings",
              ],
            },
          };
        }

        const top = scored.slice(0, 3);
        const plans = await Promise.all(
          top.map(async (issue) => ({
            issue,
            plan: await draftRemediationPlan(issue),
          })),
        );

        const blocks = plans
          .map(({ issue, plan }, idx) => {
            const estimate = issue.storyPoints
              ? `**${issue.storyPoints}** story points`
              : `~${issue._score} (heuristic, no estimate)`;
            const meta = [
              issue.status ? `_${issue.status}_` : null,
              issue.priority ? `priority: **${issue.priority}**` : null,
              issue.type ? `type: ${issue.type}` : null,
              issue.assignee ? `owner: ${issue.assignee}` : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              `### ${idx + 1}. **${issue.key}** — ${issue.title || "(no title)"}\n` +
              `Estimate: ${estimate}${meta ? `  \n${meta}` : ""}\n\n` +
              `**Draft plan to resolve:**\n${plan}`
            );
          })
          .join("\n\n---\n\n");

        const overflowLine =
          scored.length > top.length
            ? `\n\n_Showing the top **${top.length}** of **${scored.length}** ranked items. Ask about a specific key for a deeper plan._`
            : "";

        return {
          reply: applySummaryPrefix(
            `**Most complex open work items in ${jiraConfig.projectKey}** (ranked by Story Points, fallback to description length):\n\n` +
              blocks +
              overflowLine,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "Find stories related to security",
              "List Jira issues",
              "Show Jira epics",
              "Jira project details",
              "Find projects with issues",
              "Go to Settings",
            ],
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          reply: applySummaryPrefix(
            `I could not analyse Jira complexity: **${msg}**`,
            context,
          ),
          usedAgent: "jira",
          metadata: { quickReplies: baseQuickReplies },
        };
      }
    }

    if (isEpicIntent(lower)) {
      try {
        const epics = await service.getEpics();

        if (epics.length > 0) {
          return {
            reply: applySummaryPrefix(
              `Here are up to **12** epic-level items from Jira project **${jiraConfig.projectKey}**:\n\n` +
                `${formatWorkItemLines(epics, 12)}\n\n` +
                `_For the full hierarchy, use the SDLC / Hub views in Astra._`,
              context,
            ),
            usedAgent: "jira",
            metadata: { quickReplies: baseQuickReplies },
          };
        }

        // Empty result — probe the project to give a useful explanation
        // instead of a bare "No items returned." message.
        let totalIssues = 0;
        try {
          const probe = await service.searchIssuesByJql(
            `project = "${jiraConfig.projectKey}" ORDER BY created DESC`,
            5,
          );
          totalIssues = probe.length;
        } catch (err) {
          console.warn(
            "[JiraAgent] Empty-epic probe failed:",
            err instanceof Error ? err.message : err,
          );
        }

        const emptyReply =
          totalIssues === 0
            ? `Project **${jiraConfig.projectKey}** has **no issues** in Jira yet — there are no epics, tasks, or stories to show.\n\n` +
              `Create some issues in Jira (or import a backlog) and try **Show Jira epics** again. ` +
              `You can also try a different project from **List Jira projects**.`
            : `Project **${jiraConfig.projectKey}** has issues, but **no Epic-level items** were found (and no top-level tasks).\n\n` +
              `Use **List Jira issues** to see what's there, or create an Epic in Jira to organise the backlog.`;

        return {
          reply: applySummaryPrefix(emptyReply, context),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "List Jira issues",
              "List Jira tasks",
              "List Jira subtasks",
              "List Jira projects",
              "Jira project details",
              "Go to Settings",
            ],
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          reply: applySummaryPrefix(
            `I could not load epics from Jira: **${msg}**`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: ["Go to Settings", "List Jira issues", "Jira project details", ...buildNavQuickReplies(adoOn, jiraOn).slice(4)],
          },
        };
      }
    }

    if (isTaskListIntent(lower)) {
      try {
        const tasks = await service.searchIssuesByJql(
          `project = "${jiraConfig.projectKey}" AND issuetype = Task ORDER BY created DESC`,
          15,
        );

        if (tasks.length > 0) {
          const lines = formatWorkItemLines(
            tasks.map((t) => ({
              id: t.key || t.id,
              title: t.title,
              status: t.status,
            })),
            15,
          );
          return {
            reply: applySummaryPrefix(
              `Here are up to **15** **Tasks** from Jira project **${jiraConfig.projectKey}**:\n\n${lines}`,
              context,
            ),
            usedAgent: "jira",
            metadata: {
              quickReplies: [
                "List Jira subtasks",
                "List Jira issues",
                "Show Jira epics",
                "Jira project details",
                "Go to Settings",
              ],
            },
          };
        }

        const reply = await buildEmptyStateMessage(
          service,
          jiraConfig.projectKey,
          "Tasks",
          ["List Jira subtasks", "List Jira issues", "Show Jira epics"],
        );
        return {
          reply: applySummaryPrefix(reply, context),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "List Jira subtasks",
              "List Jira issues",
              "Show Jira epics",
              "Find projects with issues",
              "List Jira projects",
              "Go to Settings",
            ],
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          reply: applySummaryPrefix(`I could not load Jira tasks: **${msg}**`, context),
          usedAgent: "jira",
          metadata: {
            quickReplies: ["Go to Settings", "Jira project details", "Show Jira epics", "List Jira issues"],
          },
        };
      }
    }

    if (isSubtaskListIntent(lower)) {
      try {
        const subtasks = await service.searchIssuesByJql(
          `project = "${jiraConfig.projectKey}" AND issuetype in ("Sub-task","Subtask") ORDER BY created DESC`,
          15,
        );

        if (subtasks.length > 0) {
          const lines = formatWorkItemLines(
            subtasks.map((t) => ({
              id: t.key || t.id,
              title: t.title,
              status: t.status,
            })),
            15,
          );
          return {
            reply: applySummaryPrefix(
              `Here are up to **15** **Sub-tasks** from Jira project **${jiraConfig.projectKey}**:\n\n${lines}`,
              context,
            ),
            usedAgent: "jira",
            metadata: {
              quickReplies: [
                "List Jira tasks",
                "List Jira issues",
                "Show Jira epics",
                "Jira project details",
                "Go to Settings",
              ],
            },
          };
        }

        const reply = await buildEmptyStateMessage(
          service,
          jiraConfig.projectKey,
          "Sub-tasks",
          ["List Jira tasks", "List Jira issues", "Show Jira epics"],
        );
        return {
          reply: applySummaryPrefix(reply, context),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "List Jira tasks",
              "List Jira issues",
              "Show Jira epics",
              "Find projects with issues",
              "List Jira projects",
              "Go to Settings",
            ],
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          reply: applySummaryPrefix(`I could not load Jira subtasks: **${msg}**`, context),
          usedAgent: "jira",
          metadata: {
            quickReplies: ["Go to Settings", "Jira project details", "Show Jira epics", "List Jira issues"],
          },
        };
      }
    }

    if (isIssueListIntent(lower) || /\b(list|show)\s+jira\b/i.test(lower)) {
      try {
        // getBacklogContext returns extended fields beyond the base BacklogContext type
        const backlog = (await service.getBacklogContext()) as {
          userStories?: Array<{ id: string; title: string; status: string }>;
          epics?: unknown[];
          features?: unknown[];
        };
        const stories = backlog.userStories || [];
        const epicCount = (backlog.epics || []).length;
        const featCount = (backlog.features || []).length;

        if (stories.length > 0) {
          return {
            reply: applySummaryPrefix(
              `**Jira backlog snapshot** (${jiraConfig.projectKey})\n\n` +
                `- **Epics (loaded):** ${epicCount}\n` +
                `- **Features (loaded):** ${featCount}\n` +
                `- **Sample issues** (stories/tasks/bugs, up to 15):\n\n${formatWorkItemLines(stories, 15)}`,
              context,
            ),
            usedAgent: "jira",
            metadata: { quickReplies: baseQuickReplies },
          };
        }

        // Empty backlog — try a broader "any issuetype" fetch before giving up,
        // since many sandbox projects use only Bugs / Subtasks / custom types
        // that getBacklogContext's Story-centric JQL filters out.
        let anyIssues: Array<{ id?: string; key?: string; title?: string; status?: string }> = [];
        try {
          anyIssues = await service.searchIssuesByJql(
            `project = "${jiraConfig.projectKey}" ORDER BY created DESC`,
            15,
          );
        } catch (err) {
          console.warn(
            "[JiraAgent] Empty-issue probe failed:",
            err instanceof Error ? err.message : err,
          );
        }

        if (anyIssues.length > 0) {
          const mapped = anyIssues.map((t) => ({
            id: t.key || t.id,
            title: t.title,
            status: t.status,
          }));
          return {
            reply: applySummaryPrefix(
              `Project **${jiraConfig.projectKey}** has no Stories in the standard backlog view, ` +
                `so here are the **${anyIssues.length}** most recent issues of any type:\n\n${formatWorkItemLines(mapped, 15)}`,
              context,
            ),
            usedAgent: "jira",
            metadata: {
              quickReplies: [
                "Show Jira epics",
                "List Jira tasks",
                "List Jira subtasks",
                "Jira project details",
                "Go to Settings",
              ],
            },
          };
        }

        return {
          reply: applySummaryPrefix(
            `Project **${jiraConfig.projectKey}** has **no issues** in Jira yet — there are no epics, stories, tasks, or subtasks to show.\n\n` +
              `Create some issues in Jira (or import a backlog) and try again, or pick a different project from **List Jira projects**.`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "List Jira projects",
              "Jira project details",
              "Go to Settings",
              ...(adoOn ? (["Query ADO data"] as const) : []),
            ],
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          reply: applySummaryPrefix(
            `I could not load issues from Jira: **${msg}**`,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: ["Go to Settings", "Jira project details", "Show Jira epics", ...buildNavQuickReplies(adoOn, jiraOn).slice(4)],
          },
        };
      }
    }

    // ── LLM fallback ────────────────────────────────────────────────────
    // Nothing above matched. Try the LLM topic interpreter so free-form
    // phrasings ("userstories about security", "any auth issues") still
    // route to the right handler instead of dumping the landing reply.
    const llmHint = await interpretJiraMessageWithLLM(message, jiraConfig.projectKey);

    if (llmHint.action === "semantic_search" && llmHint.topic) {
      const topics =
        llmHint.synonyms && llmHint.synonyms.length > 0
          ? Array.from(new Set([llmHint.topic, ...llmHint.synonyms]))
          : [llmHint.topic];
      try {
        const jql = buildTopicJql(
          jiraConfig.projectKey,
          topics,
          llmHint.issueTypes || [],
        );
        console.log(`[JiraAgent] LLM semantic JQL: ${jql}`);
        const matches = await service.searchIssuesRich(jql, 25);

        if (matches.length === 0) {
          return {
            reply: applySummaryPrefix(
              `I did not find any issues in **${jiraConfig.projectKey}** matching **"${llmHint.topic}"** ` +
                `(searched ${topics.length} related keyword${topics.length === 1 ? "" : "s"}: ${topics
                  .slice(0, 6)
                  .map((t) => `\`${t}\``)
                  .join(", ")}${topics.length > 6 ? ", …" : ""}).\n\n` +
                `Try a related term, or use **List Jira issues** to browse the backlog.`,
              context,
            ),
            usedAgent: "jira",
            metadata: {
              quickReplies: [
                "List Jira issues",
                "Show Jira epics",
                "Which tasks are most complex?",
                "Find projects with issues",
                "Jira project details",
                "Go to Settings",
              ],
            },
          };
        }

        const lines = matches
          .slice(0, 15)
          .map((m, i) => {
            const status = m.status ? ` — _${m.status}_` : "";
            const priority = m.priority ? ` · priority: **${m.priority}**` : "";
            const type = m.type ? ` · ${m.type}` : "";
            return `${i + 1}. **${m.key}** — ${m.title || "(no title)"}${type}${status}${priority}`;
          })
          .join("\n");

        const overflow =
          matches.length > 15
            ? `\n\n_Showing 15 of ${matches.length} matches. Refine the topic for a tighter list._`
            : "";

        const synonymsLine =
          topics.length > 1
            ? `\n\n_Expanded **"${llmHint.topic}"** to: ${topics
                .slice(0, 8)
                .map((t) => `\`${t}\``)
                .join(", ")}${topics.length > 8 ? ", …" : ""}._`
            : "";

        return {
          reply: applySummaryPrefix(
            `Here are **${Math.min(matches.length, 15)}** item${
              matches.length === 1 ? "" : "s"
            } in **${jiraConfig.projectKey}** related to **"${llmHint.topic}"**:\n\n` +
              lines +
              overflow +
              synonymsLine,
            context,
          ),
          usedAgent: "jira",
          metadata: {
            quickReplies: [
              "Which tasks are most complex?",
              "Show Jira epics",
              "List Jira issues",
              "Find projects with issues",
              "Jira project details",
              "Go to Settings",
            ],
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[JiraAgent] LLM-driven semantic search failed:", msg);
        // fall through to landing reply
      }
    }

    if (llmHint.action === "complexity_analysis") {
      return jiraAgent.process({
        message: "Which tasks are most complex?",
        context,
      });
    }
    if (llmHint.action === "list_epics") {
      return jiraAgent.process({ message: "Show Jira epics", context });
    }
    if (llmHint.action === "list_tasks") {
      return jiraAgent.process({ message: "List Jira tasks", context });
    }
    if (llmHint.action === "list_subtasks") {
      return jiraAgent.process({ message: "List Jira subtasks", context });
    }
    if (llmHint.action === "list_issues") {
      return jiraAgent.process({ message: "List Jira issues", context });
    }
    if (llmHint.action === "project_details") {
      return jiraAgent.process({ message: "Jira project details", context });
    }

    // ── End LLM fallback ────────────────────────────────────────────────

    // Default landing — generic queries like "Query Jira data" or "hi" with
    // a project in context land here. Show the user real, clickable choices
    // (organizations + actions) instead of just naming their project key.
    const landingOrgs = await listTenantJiraConnections(context.userId);
    const orgChipNames = landingOrgs
      .slice(0, MAX_ORG_CHIPS)
      .map((o) => `List projects in ${o.name}`);

    const orgsLine = landingOrgs.length
      ? `Available Jira organizations: ${landingOrgs
          .slice(0, 6)
          .map((o) => `**${o.name}**`)
          .join(", ")}${landingOrgs.length > 6 ? ", …" : ""}.`
      : `_No Jira connections registered yet — add one in **Settings**._`;

    return {
      reply: applySummaryPrefix(
        `**Jira Agent** — pick what you'd like to do:\n\n` +
          `- **List projects in an organization** (use the chips below)\n` +
          `- **Show Jira epics** or **List Jira issues** for the active project (**${jiraConfig.projectKey}**)\n` +
          `- **Find stories related to <topic>** (e.g. security, payments) for semantic search\n` +
          `- **Which tasks are most complex?** to rank by Story Points and get a plan draft\n` +
          `- **Jira project details** for the active project\n` +
          `- **Find projects with issues** to scan for content\n\n` +
          orgsLine,
        context,
      ),
      usedAgent: "jira",
      metadata: {
        quickReplies: [
          ...orgChipNames,
          "Show Jira epics",
          "List Jira issues",
          "Find stories related to security",
          "Which tasks are most complex?",
          "Jira project details",
          "Find projects with issues",
          "Go to Settings",
        ],
      },
    };
  },
};
