import type { Agent, AgentRequest, AgentResponse } from "../superAgent/types";
import { getAllowedWorkItemPlatforms } from "../../platform/hosting";

function applySummaryPrefix(
  baseReply: string,
  context: AgentRequest["context"],
): string {
  const summary = context.summary?.trim();
  if (!summary) return baseReply;
  return (
    `Here is a summary of your previous conversation for context:\n` +
    `${summary}\n\n` +
    baseReply
  );
}

/** Matches product copy and classifier routing. */
function isExploreChip(lower: string): boolean {
  return /\bexplore\s+modernization\b/i.test(lower);
}

function wantsPhasesExplainer(lower: string): boolean {
  return (
    /\b(phase|phases|stage|stages|pipeline|workflow|step|steps)\b/i.test(lower) &&
    /\b(modern|upgrad|stack|tech|repo|devx)\b/i.test(lower)
  );
}

function wantsGettingStarted(lower: string): boolean {
  return (
    /\b(how\s+do\s+i|how\s+to|get\s+started|start|begin|open|navigate|where\s+is|where\s+do\s+i)\b/i.test(
      lower,
    ) && /\b(modern|upgrad|stack|tech|repo)\b/i.test(lower)
  );
}

function wantsSupportedStacks(lower: string): boolean {
  return (
    /\b(support|supported|language|languages|stack|stacks|framework|dotnet|node|java|python|go|react)\b/i.test(
      lower,
    ) && /\b(modern|upgrad|repo|analyze|profile)\b/i.test(lower)
  );
}

function wantsRiskOrPlanning(lower: string): boolean {
  return (
    /\b(risk|compatibility|breaking|plan|planning|assessment|dependency|version\s*intelligence)\b/i.test(
      lower,
    ) && /\b(modern|upgrad|stack|repo)\b/i.test(lower)
  );
}

function wantsPublishOrIntegrations(lower: string): boolean {
  return (
    /\b(publish|push|pr|pull\s*request|ado|azure|github|pat|token)\b/i.test(lower) &&
    /\b(modern|upgrad|stack|code|repo)\b/i.test(lower)
  );
}

function buildNavQuickReplies(adoOn: boolean, jiraOn: boolean): string[] {
  const q = [
    "How do I start a tech stack upgrade?",
    "What phases does modernization use?",
    "Explore Modernization",
  ];
  if (adoOn) q.push("Query ADO data");
  if (jiraOn) q.push("Query Jira data");
  q.push("What can you do?");
  return q;
}

const PHASES_OVERVIEW = `**Typical pipeline stages** (Tech Stack Upgrade):

1. **Repository profiling** — structure, manifests, frameworks, and runtime signals from your codebase.
2. **Dependency analysis** — package graph and cross-project relationships.
3. **Version intelligence** — current vs candidate versions (NuGet, npm, Maven, etc.).
4. **Compatibility check & risk report** — after you pick target versions: breaking-change awareness and planning narrative.
5. **Task planning** — ordered upgrade tasks derived from the plan.
6. **Code upgrade** — AI-assisted edits with review/diff in the Stack Modernization IDE.
7. **Completeness verification** — sanity check that expected migrations were applied.
8. **Test generation** — suggested tests around upgraded areas.
9. **Run & validate** *(when enabled for your tenant)* — optional automated test run against the upgraded tree.

You can **narrow phases** on the landing flow so skipped stages appear as skipped in progress.`;

const STACKS_OVERVIEW = `**Stacks Astra analyzes** include Node.js, Python, Java (Maven/Gradle), .NET, Go, Ruby, PHP, and common web stacks (React, Angular, Vue, Next.js) when manifests and project files are present—plus **ZIP / folder uploads** and **ADO-linked repositories** where configured.`;

const GETTING_STARTED = `**Getting started**

1. Open **Stack Modernization** from the Astra hub (or go to \`/stack-modernization\`).
2. Choose **Tech Stack Upgrade** (\`/stack-modernization/tech-stack-upgrade\`). Other modernization types may show as *coming soon*.
3. **Upload** a repository archive or connect source material as the UI allows, pick an **LLM profile** if prompted, and run **assessment**.
4. Review **version recommendations**, select targets, then proceed through **planning → tasks → code upgrade → tests** (and validation if enabled).
5. Use **Publish** when you are ready to push changes to **Azure DevOps** or **GitHub** (requires appropriate credentials / PAT where applicable).

There is also a **Stack Modernization v2** experience at \`/stack-modernization-v2\` when your deployment exposes it.`;

const INTEGRATION_NOTES = `**Integrations**

- **Azure DevOps**: PAT resolution and repo listing reuse your Astra ADO settings (see **Settings**). Publishing uses \`POST /api/stack-modernization/publish\`.
- **LLM choice**: \`GET /api/stack-modernization/llm-providers\` exposes configured models (e.g. GPT / Claude) for the workflow.`;

const DEFAULT_INTRO = `I am the **Modernization agent** for Astra **Stack Modernization**—the module that **profiles repositories**, **graphs dependencies**, suggests **target framework/runtime versions**, produces **risk-aware upgrade plans**, runs **task-based code upgrades**, **generates tests**, and optionally **validates** builds.

${GETTING_STARTED}

${PHASES_OVERVIEW}

${STACKS_OVERVIEW}

${INTEGRATION_NOTES}`;

export const modernizationAgent: Agent = {
  name: "Modernization Agent",
  description:
    "Explains Stack Modernization (tech stack upgrade): workflow, phases, navigation, and how it ties to ADO/GitHub and LLM configuration.",

  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const lower = message.toLowerCase().trim();
    const platforms = getAllowedWorkItemPlatforms();
    const adoOn = platforms.includes("ado");
    const jiraOn = platforms.includes("jira");
    const chips = buildNavQuickReplies(adoOn, jiraOn);

    if (isExploreChip(lower)) {
      return {
        reply: applySummaryPrefix(
          `${DEFAULT_INTRO}\n\nUse the quick replies to go deeper on **phases**, **getting started**, or **supported stacks**.`,
          context,
        ),
        usedAgent: "modernization",
        metadata: { quickReplies: chips },
      };
    }

    if (wantsGettingStarted(lower)) {
      return {
        reply: applySummaryPrefix(GETTING_STARTED, context),
        usedAgent: "modernization",
        metadata: { quickReplies: chips },
      };
    }

    if (wantsPhasesExplainer(lower)) {
      return {
        reply: applySummaryPrefix(PHASES_OVERVIEW, context),
        usedAgent: "modernization",
        metadata: { quickReplies: chips },
      };
    }

    if (wantsSupportedStacks(lower)) {
      return {
        reply: applySummaryPrefix(STACKS_OVERVIEW, context),
        usedAgent: "modernization",
        metadata: { quickReplies: chips },
      };
    }

    if (wantsRiskOrPlanning(lower)) {
      return {
        reply: applySummaryPrefix(
          `**Planning & risk in Stack Modernization**\n\n` +
            `After assessment, you choose **target versions** for packages/runtimes. Astra then runs a **compatibility** pass and a **risk report** that highlights likely breaking changes, deprecated APIs, and sequencing hints before **task planning** breaks work into executable steps.\n\n` +
            `During **code upgrade**, each task can modify files with diff review; **completeness verification** checks that expected edits landed.\n\n` +
            PHASES_OVERVIEW,
          context,
        ),
        usedAgent: "modernization",
        metadata: { quickReplies: chips },
      };
    }

    if (wantsPublishOrIntegrations(lower)) {
      return {
        reply: applySummaryPrefix(
          `**Publishing & credentials**\n\n` +
            INTEGRATION_NOTES +
            `\n\nIf PAT or org/project selection fails, open **Settings** in Astra and confirm **Azure DevOps** (or GitHub, if offered) is configured, then retry from the **Publish** modal inside Stack Modernization.`,
          context,
        ),
        usedAgent: "modernization",
        metadata: { quickReplies: chips },
      };
    }

    return {
      reply: applySummaryPrefix(DEFAULT_INTRO, context),
      usedAgent: "modernization",
      metadata: { quickReplies: chips },
    };
  },
};
