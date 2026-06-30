/**
 * Generates .devx/ context files for AI-assisted development.
 * These files make the repo AI-tool-agnostic  -  works with Claude Code,
 * Cursor, GitHub Copilot, Windsurf, Cline, Kiro, and any AI IDE.
 */

import type { SpecsGenerationFeature, SpecsGenerationResult } from "./specs-generator.service";
import { generateAllSkillBodies } from "./skill-llm-generator";
import type { GoldenRepoUiDesignPackage } from "./golden-ui-design-extractor";

interface DevxContextOptions {
  projectName: string;
  projectDescription?: string;
  organization?: string;
  specsArchitectureStyle?: "monolith" | "microservices";
  specsDeliveryOrder?: "ui-first" | "api-first" | null;
  features: SpecsGenerationFeature[];
  results: SpecsGenerationResult[];
  enableTdd: boolean;
  llmProvider?: string;
  goldenRepoContext?: {
    repoId?: string;
    repoName?: string;
    organization?: string;
    project?: string;
    provider?: string;
    repoUrl?: string;
    defaultBranch?: string;
    selectedPaths?: string[];
    uiDesignPackage?: GoldenRepoUiDesignPackage;
  };
}

type GoldenRepoContext = DevxContextOptions["goldenRepoContext"];

function cleanRichText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type RepoType = "ui" | "api" | "worker" | "shared-lib" | "infra" | "unknown";

interface FeatureRoutingPlan {
  featureId: number;
  featureTitle: string;
  slug: string;
  specsHomeRepoType: "ui" | "api";
  ownerRepoType: RepoType;
  impactedRepoTypes: RepoType[];
  repoTypesToCheck: RepoType[];
  repoPlanCandidates: RepoType[];
  rationale: string[];
  signals: {
    ui: boolean;
    api: boolean;
    worker: boolean;
    shared: boolean;
  };
}

/**
 * Generate all .devx/ context files and per-feature prompt.md files.
 * Returns an array of { path, content, fileType, fileName, featureId, featureTitle } entries.
 */
export async function generateDevxContext(options: DevxContextOptions): Promise<Array<{
  path: string;
  content: string;
  fileType: string;
  fileName: string;
  featureId: number;
  featureTitle: string;
}>> {
  const {
    projectName,
    projectDescription,
    organization,
    specsArchitectureStyle,
    specsDeliveryOrder,
    features,
    results,
    enableTdd,
    llmProvider,
    goldenRepoContext,
  } = options;
  const effectiveLlmProvider = resolveLlmProvider(llmProvider);
  const architectureStyle = specsArchitectureStyle === "microservices" ? "microservices" : "monolith";
  const deliveryOrder = architectureStyle === "microservices"
    ? (specsDeliveryOrder === "api-first" ? "api-first" : "ui-first")
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const featureRoutingPlans = buildFeatureRoutingPlans(
    features,
    results,
    architectureStyle,
    deliveryOrder,
  );
  const files: Array<{
    path: string;
    content: string;
    fileType: string;
    fileName: string;
    featureId: number;
    featureTitle: string;
  }> = [];

  //  1. specs/.devx/README.md
  files.push({
    path: "specs/.devx/README.md",
    content: generateDevxReadme(enableTdd, architectureStyle),
    fileType: "devx-context",
    fileName: "README.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  2. specs/.devx/project.md
  files.push({
    path: "specs/.devx/project.md",
    content: generateProjectMd(
      projectName,
      projectDescription,
      organization,
      features,
      enableTdd,
      today,
      architectureStyle,
    ),
    fileType: "devx-context",
    fileName: "project.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  3. specs/.devx/workflow.md
  files.push({
    path: "specs/.devx/workflow.md",
    content: generateWorkflowMd(enableTdd),
    fileType: "devx-context",
    fileName: "workflow.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  4. specs/.devx/features.json
  files.push({
    path: "specs/.devx/features.json",
    content: generateFeaturesJson(features, results, enableTdd),
    fileType: "devx-context",
    fileName: "features.json",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/tracker.json",
    content: generateTrackerJson(features),
    fileType: "devx-context",
    fileName: "tracker.json",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/generation.json",
    content: generateGenerationJson(features),
    fileType: "devx-context",
    fileName: "generation.json",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  5. specs/.devx/architecture.md
  files.push({
    path: "specs/.devx/architecture.md",
    content: generateArchitectureMd(projectName, features, architectureStyle),
    fileType: "devx-context",
    fileName: "architecture.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  6. specs/.devx/instruction.md
  files.push({
    path: "specs/.devx/instruction.md",
    content: generateInstructionMd(architectureStyle, deliveryOrder, today),
    fileType: "devx-context",
    fileName: "instruction.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  7. specs/.devx/init.sh
  files.push({
    path: "specs/.devx/init.sh",
    content: generateInitScript(),
    fileType: "devx-context",
    fileName: "init.sh",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  8. specs/.devx/discover-workspace.sh
  files.push({
    path: "specs/.devx/discover-workspace.sh",
    content: generateWorkspaceDiscoveryScript(),
    fileType: "devx-context",
    fileName: "discover-workspace.sh",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  9. MCP Server files
  files.push({
    path: "specs/.devx/mcp/server.js",
    content: generateMcpServerJs(),
    fileType: "devx-context",
    fileName: "server.js",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/mcp/package.json",
    content: generateMcpPackageJson(projectName),
    fileType: "devx-context",
    fileName: "package.json",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/mcp/README.md",
    content: generateMcpReadme(),
    fileType: "devx-context",
    fileName: "README.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/commands/implement-next.md",
    content: generateCommandImplementNext(),
    fileType: "devx-context",
    fileName: "implement-next.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/commands/autopilot.md",
    content: generateCommandAutopilot(),
    fileType: "devx-context",
    fileName: "autopilot.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/commands/implement-feature.md",
    content: generateCommandImplementFeature(),
    fileType: "devx-context",
    fileName: "implement-feature.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/commands/validate-feature.md",
    content: generateCommandValidateFeature(),
    fileType: "devx-context",
    fileName: "validate-feature.md",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/devx-command.sh",
    content: generateDevxCommandScript(enableTdd),
    fileType: "devx-context",
    fileName: "devx-command.sh",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/validate-tracking.sh",
    content: generateTrackingValidationScript(),
    fileType: "devx-context",
    fileName: "validate-tracking.sh",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/.gitignore",
    content: generateDevxGitignore(),
    fileType: "devx-context",
    fileName: ".gitignore",
    featureId: 0,
    featureTitle: ".devx",
  });

  files.push({
    path: "specs/.devx/mcp/.gitignore",
    content: generateMcpGitignore(),
    fileType: "devx-context",
    fileName: ".gitignore",
    featureId: 0,
    featureTitle: ".devx",
  });

  //  10. Claude Code Skills (SKILL.md inside named folders) — LLM-generated, project-aware
  const skillBodies = await generateAllSkillBodies({
    projectName,
    projectDescription,
    architectureStyle,
    enableTdd,
    features,
    goldenRepoContext,
    llmProvider: effectiveLlmProvider,
  });

  const skillMeta = [
    { slug: "implement", body: skillBodies.implement },
    { slug: "validate", body: skillBodies.validate },
    { slug: "next", body: skillBodies.next },
    { slug: "autopilot", body: skillBodies.autopilot },
    { slug: "ui-skill", body: skillBodies.uiSkill },
  ];

  for (const skill of skillMeta) {
    files.push({
      path: `specs/.devx/skills/${skill.slug}/SKILL.md`,
      content: buildSkillDocument({
        name: skill.slug,
        body: skill.body,
        goldenRepoContext,
        llmProvider: effectiveLlmProvider,
      }),
      fileType: "devx-context",
      fileName: "SKILL.md",
      featureId: 0,
      featureTitle: ".devx",
    });
  }

  if (goldenRepoContext?.uiDesignPackage) {
    files.push({
      path: "specs/.devx/skills/ui-skill/golden-ui-design-system.md",
      content: goldenRepoContext.uiDesignPackage.consolidatedGuidelines,
      fileType: "devx-context",
      fileName: "golden-ui-design-system.md",
      featureId: 0,
      featureTitle: ".devx",
    });

    files.push({
      path: "specs/.devx/skills/ui-skill/golden-ui-design-sources.md",
      content: goldenRepoContext.uiDesignPackage.extractionNotes,
      fileType: "devx-context",
      fileName: "golden-ui-design-sources.md",
      featureId: 0,
      featureTitle: ".devx",
    });
  }

  files.push(
    ...generatePromptFiles({
      features,
      results,
      enableTdd,
      specsArchitectureStyle,
      specsDeliveryOrder,
    }),
  );

  return files;
}

function buildFeatureRoutingPlans(
  features: SpecsGenerationFeature[],
  results: SpecsGenerationResult[],
  architectureStyle: "monolith" | "microservices",
  deliveryOrder: "ui-first" | "api-first" | null,
): FeatureRoutingPlan[] {
  return architectureStyle === "microservices"
    ? results.map((result) =>
        inferFeatureRouting(
          features.find((feature) => feature.id === result.featureId),
          result,
          deliveryOrder,
        ),
      )
    : [];
}

export function generatePromptFiles(options: {
  features: SpecsGenerationFeature[];
  results: SpecsGenerationResult[];
  enableTdd: boolean;
  specsArchitectureStyle?: "monolith" | "microservices";
  specsDeliveryOrder?: "ui-first" | "api-first" | null;
}): Array<{
  path: string;
  content: string;
  fileType: "prompt";
  fileName: "prompt.md";
  featureId: number;
  featureTitle: string;
}> {
  const {
    features,
    results,
    enableTdd,
    specsArchitectureStyle,
    specsDeliveryOrder,
  } = options;
  const architectureStyle =
    specsArchitectureStyle === "microservices" ? "microservices" : "monolith";
  const deliveryOrder =
    architectureStyle === "microservices"
      ? specsDeliveryOrder === "api-first"
        ? "api-first"
        : "ui-first"
      : null;
  const featureRoutingPlans = buildFeatureRoutingPlans(
    features,
    results,
    architectureStyle,
    deliveryOrder,
  );

  return results.map((result) => {
    const feature = features.find((f) => f.id === result.featureId);
    const slug = slugifyFeatureTitle(result.featureTitle, result.featureId);

    return {
      path: `specs/${slug}/prompt.md`,
      content: generateFeaturePrompt(
        result,
        feature,
        enableTdd,
        architectureStyle,
        architectureStyle === "microservices"
          ? featureRoutingPlans.find((plan) => plan.featureId === result.featureId)
          : undefined,
      ),
      fileType: "prompt" as const,
      fileName: "prompt.md" as const,
      featureId: result.featureId,
      featureTitle: result.featureTitle,
    };
  });
}

function slugifyFeatureTitle(title: string | undefined, featureId: number): string {
  return (
    (title || `feature-${featureId}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `feature-${featureId}`
  );
}

function inferFeatureRouting(
  feature: SpecsGenerationFeature | undefined,
  result: SpecsGenerationResult,
  deliveryOrder: "ui-first" | "api-first" | null,
): FeatureRoutingPlan {
  const specsHomeRepoType = deliveryOrder === "api-first" ? "api" : "ui";
  const slug = slugifyFeatureTitle(result.featureTitle, result.featureId);
  const sourceText = [
    result.featureTitle,
    cleanRichText(feature?.description),
    ...((feature?.userStories || []).flatMap((story) => [
      cleanRichText(story.title),
      cleanRichText(story.description),
      cleanRichText(story.acceptanceCriteria),
    ])),
    result.specsContent,
    result.requirementsContent,
    result.tddTestsContent,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const hasKeyword = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(sourceText));

  const ui = hasKeyword([
    /\bui\b/,
    /\bux\b/,
    /\bpage\b/,
    /\bscreen\b/,
    /\bdashboard\b/,
    /\bform\b/,
    /\bmodal\b/,
    /\bbutton\b/,
    /\bnavigation\b/,
    /\bclient\b/,
    /\bfrontend\b/,
    /\breact\b/,
    /\bview\b/,
  ]);
  const api = hasKeyword([
    /\bapi\b/,
    /\bendpoint\b/,
    /\bservice\b/,
    /\bmicroservice\b/,
    /\bbackend\b/,
    /\bdatabase\b/,
    /\bpersist/,
    /\bintegration\b/,
    /\borchestrat/,
    /\bauth\b/,
    /\btoken\b/,
    /\bqueue\b/,
    /\bevent\b/,
    /\bworkflow\b/,
    /\bcontract\b/,
  ]);
  const worker = hasKeyword([
    /\bqueue\b/,
    /\basync\b/,
    /\bbackground\b/,
    /\bschedule\b/,
    /\bcron\b/,
    /\bbatch\b/,
    /\bprocessor\b/,
    /\bconsumer\b/,
    /\bworker\b/,
    /\bjob\b/,
  ]);
  const shared = hasKeyword([
    /\bshared\b/,
    /\blibrary\b/,
    /\bcommon\b/,
    /\bsdk\b/,
    /\bdto\b/,
    /\bschema\b/,
    /\bcontract\b/,
    /\bpackage\b/,
  ]);

  const rationale: string[] = [
    `Specs home defaults to the ${specsHomeRepoType} repo because delivery order is ${deliveryOrder === "api-first" ? "API-first" : "UI-first"}.`,
  ];

  let ownerRepoType: RepoType = specsHomeRepoType;
  if (worker && !ui) {
    ownerRepoType = "worker";
    rationale.push("Feature text contains background-processing signals, so a worker/service repo is the best primary owner.");
  } else if (api && !ui) {
    ownerRepoType = "api";
    rationale.push("Feature text is backend-heavy, so an API/service repo is the best primary owner.");
  } else if (ui && !api) {
    ownerRepoType = "ui";
    rationale.push("Feature text is UI-heavy, so a UI repo is the best primary owner.");
  } else if (api && ui) {
    ownerRepoType = specsHomeRepoType;
    rationale.push(`Feature includes both UI and backend signals, so the ${specsHomeRepoType} repo is the default owner and the other side is marked as impacted.`);
  } else {
    rationale.push(`No strong technical signals were found, so the ${specsHomeRepoType} repo is the default owner.`);
  }

  const impactedRepoTypes = Array.from(
    new Set<RepoType>(
      [
        ownerRepoType,
        ui ? "ui" : null,
        api ? "api" : null,
        worker ? "worker" : null,
        shared ? "shared-lib" : null,
      ].filter((value): value is RepoType => Boolean(value)),
    ),
  );

  const repoTypesToCheck = Array.from(
    new Set<RepoType>([specsHomeRepoType, ...impactedRepoTypes]),
  );

  const repoPlanCandidates = Array.from(
    new Set<RepoType>(
      impactedRepoTypes.filter((repoType) => repoType !== specsHomeRepoType),
    ),
  );

  return {
    featureId: result.featureId,
    featureTitle: result.featureTitle,
    slug,
    specsHomeRepoType,
    ownerRepoType,
    impactedRepoTypes,
    repoTypesToCheck,
    repoPlanCandidates,
    rationale,
    signals: {
      ui,
      api,
      worker,
      shared,
    },
  };
}

//  File Generators 

function generateDevxReadme(enableTdd: boolean, architectureStyle: "monolith" | "microservices"): string {
  const tddLine = enableTdd
    ? "- If `tdd-tests.md` exists for a feature, follow the Red -> Green -> Refactor flow before completing the requirement."
    : "";
  const microservicesLine = architectureStyle === "microservices"
    ? "- Run workspace discovery before implementation so `feature-routing.json`, `workspace-repos.json`, and `workspace-context.md` reflect the target workspace."
    : "";

  return [
    "# DevX Specs Toolkit",
    "",
    "This folder contains the generated command scripts, project context, tracking files, MCP server, and AI-tool setup helpers for spec-driven development.",
    "",
    "## Quick Start",
    "",
    "Run this once from the repository root after specs are generated:",
    "",
    "```bash",
    "bash specs/.devx/init.sh",
    "```",
    "",
    "For a non-interactive Codex setup:",
    "",
    "```bash",
    "bash specs/.devx/init.sh --yes codex",
    "```",
    "",
    "Then ask your AI tool to use the generated project context and feature prompts. The source of truth is `specs/.devx/features.json`, `specs/.devx/tracker.json`, and each `specs/<feature-slug>/` folder.",
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `README.md` | Command reference for the generated DevX toolkit |",
    "| `project.md` | Project overview, feature list, and generated specs structure |",
    "| `workflow.md` | Spec-driven development workflow |",
    "| `instruction.md` | Architecture, repository, and delivery-order rules |",
    "| `architecture.md` | Generated system architecture summary |",
    "| `features.json` | Machine-readable feature index and generated file paths |",
    "| `tracker.json` | Code-generation execution status by feature |",
    "| `generation.json` | Specs generation metadata |",
    "| `init.sh` | AI-tool configuration and workspace bootstrap script |",
    "| `discover-workspace.sh` | Workspace scanner for repo, route, API, database, and UI context |",
    "| `validate-tracking.sh` | Guard that checks feature/tracker consistency before code generation |",
    "| `devx-command.sh` | Prompt emitter for implementation and validation commands |",
    "| `commands/*.md` | Command templates used by AI tools |",
    "| `mcp/` | Local MCP server that exposes specs to compatible AI tools |",
    "| `skills/*/SKILL.md` | Generated AI skills for implementation, validation, next-feature, autopilot, and UI work |",
    "| `skills/ui-skill/golden-ui-design-system.md` | LLM-consolidated UI/UX design system extracted from the Golden Repository when available |",
    "| `skills/ui-skill/golden-ui-design-sources.md` | Raw Golden Repository UI/UX source files preserved for exact local reference when available |",
    "",
    "## Init Commands",
    "",
    "Use `init.sh` to configure AI tooling and optional workspace bootstrap files.",
    "",
    "```bash",
    "bash specs/.devx/init.sh",
    "bash specs/.devx/init.sh --dry-run",
    "bash specs/.devx/init.sh --yes codex",
    "bash specs/.devx/init.sh --only ai claude",
    "bash specs/.devx/init.sh --list-tools",
    "```",
    "",
    "Common options:",
    "",
    "| Option | Use |",
    "| --- | --- |",
    "| `--dry-run` | Show planned actions without writing generated config files |",
    "| `--yes` | Use safe defaults and skip confirmations |",
    "| `--force` | Allow overwriting generated targets after preview |",
    "| `--force-lock` | Replace a stale `specs/.devx/init.lock` after confirming no init process is running |",
    "| `--debug` | Print detection and execution details |",
    "| `--only <scope>` | Run only `ui`, `backend`, `database`, `ai`, or `discovery` setup |",
    "| `--skip validation` | Skip post-scaffold validation |",
    "| `--reset-devx-config` | Reset `specs/.devx/config.json` before running |",
    "| `--list-tools` | List supported AI tools |",
    "",
    "Supported AI tool names:",
    "",
    "```text",
    "claude",
    "codex",
    "cursor",
    "copilot",
    "windsurf",
    "cline",
    "kiro",
    "```",
    "",
    "## Workspace Discovery",
    "",
    "Run discovery in the cloned target workspace before implementation, especially for brownfield or multi-repo work.",
    "",
    "```bash",
    "bash specs/.devx/discover-workspace.sh",
    "```",
    "",
    "Discovery updates:",
    "",
    "| Output | Use |",
    "| --- | --- |",
    "| `workspace-repos.json` | Repository inventory and detected capabilities |",
    "| `workspace-context.md` | Human-readable implementation context |",
    "| `feature-routing.json` | Suggested owner and impacted repos for each feature |",
    "| `repo-plans.json` | Proposed future repo/service plans when no existing owner is clear |",
    "",
    "## Tracking Preflight",
    "",
    "Run this before generated code work:",
    "",
    "```bash",
    "bash specs/.devx/validate-tracking.sh",
    "```",
    "",
    "The preflight checks `features.json`, `tracker.json`, generated spec folders, and Git workspace state. It stops when tracking is inconsistent, the branch is behind/diverged, local commits are unpushed, or uncommitted changes exist.",
    "",
    "Use this override only when you intentionally need to bypass the dirty-worktree guard:",
    "",
    "```bash",
    "DEVX_ALLOW_DIRTY=1 bash specs/.devx/validate-tracking.sh",
    "```",
    "",
    "## Code Generation Commands",
    "",
    "Use `devx-command.sh` to emit focused prompts for your AI assistant.",
    "",
    "```bash",
    "bash specs/.devx/devx-command.sh implement-next",
    "bash specs/.devx/devx-command.sh implement-feature <feature-slug>",
    "bash specs/.devx/devx-command.sh validate-feature <feature-slug>",
    "bash specs/.devx/devx-command.sh autopilot [max-features]",
    "```",
    "",
    "| Command | Use |",
    "| --- | --- |",
    "| `implement-next` | Select the first `PENDING` feature and emit its implementation prompt |",
    "| `implement-feature <feature-slug>` | Emit an implementation prompt for one named feature |",
    "| `validate-feature <feature-slug>` | Emit a validation prompt for one named feature |",
    "| `autopilot [max-features]` | Emit a loop prompt that implements pending features until the limit or a stop condition |",
    "",
    "Each command runs `validate-tracking.sh` first.",
    "",
    "## MCP Server",
    "",
    "The generated MCP server lets compatible AI tools read specs directly.",
    "",
    "```bash",
    "cd specs/.devx/mcp",
    "npm install",
    "node server.js",
    "```",
    "",
    "Most users should run `bash specs/.devx/init.sh` instead; it installs MCP dependencies and writes supported tool config where possible.",
    "",
    "## Feature Workflow",
    "",
    "1. Run `bash specs/.devx/init.sh --yes <tool>` or use the interactive init.",
    "2. Run `bash specs/.devx/discover-workspace.sh` when implementing in a cloned/brownfield workspace.",
    "3. Run `bash specs/.devx/validate-tracking.sh`.",
    "4. Pick a feature from `specs/.devx/features.json` or run `bash specs/.devx/devx-command.sh implement-next`.",
    "5. Read the selected feature's `specs.md`, `requirements.md`, `prompt.md`, and optional `tdd-tests.md`.",
    "6. Implement one requirement at a time.",
    "7. Run `bash specs/.devx/devx-command.sh validate-feature <feature-slug>` and verify every requirement.",
    "8. When complete, mark only that feature as done in `features.json` and `tracker.json`, then commit code and tracking updates together.",
    "",
    microservicesLine,
    tddLine,
    "",
  ].join("\n");
}

function generateProjectMd(
  projectName: string,
  description: string | undefined,
  organization: string | undefined,
  features: SpecsGenerationFeature[],
  enableTdd: boolean,
  today: string,
  architectureStyle: "monolith" | "microservices",
): string {
  const featureList = features
    .map((f) => `- **${f.title}** (${f.userStories.length} user stories)`)
    .join("\n");
  const routingStep = architectureStyle === "microservices"
    ? "4. Review `specs/.devx/feature-routing.json` for suggested owning and impacted repos\n"
    : "";
  const pickStepNumber = architectureStyle === "microservices" ? 5 : 4;
  const openStepNumber = architectureStyle === "microservices" ? 6 : 5;
  const followStepNumber = architectureStyle === "microservices" ? 7 : 6;
  const routingStructureLine = architectureStyle === "microservices"
    ? "    feature-routing.json  ->  Suggested repo routing\n"
    : "";

  return `# ${projectName}

> Auto-generated project context for AI-assisted development.
> Last updated: ${today}

${organization ? `**Organization:** ${organization}\n` : ""}${description ? `\n## Overview\n\n${description}\n` : ""}
## Development Methodology

This project follows **Spec-Driven Development (SDD)**${enableTdd ? " with **Test-Driven Development (TDD)**" : ""}.

Every feature has:
- \`specs.md\`  -  Full technical specification
- \`requirements.md\`  -  Acceptance criteria checklist
${enableTdd ? "- `tdd-tests.md`  -  Test specifications (Red  ->  Green  ->  Refactor)\n" : ""}- \`prompt.md\`  -  Ready-to-use implementation prompt

## Features (${features.length})

${featureList}

## Getting Started

1. Read this file for project context
2. Check \`specs/.devx/workflow.md\` for the development workflow
3. Review \`specs/.devx/instruction.md\` for architecture and multi-repo rules
${routingStep}${pickStepNumber}. Pick a feature from \`specs/.devx/features.json\`
${openStepNumber}. Open the feature's \`prompt.md\` and use it with your AI assistant
${followStepNumber}. Follow the spec and requirements to implement

## Project Structure

\`\`\`
specs/
  .devx/
    project.md           ->  You are here
    workflow.md           ->  Development workflow
    features.json         ->  Feature index (machine-readable)
    tracker.json          ->  Code-generation execution status
    generation.json       ->  Last generation metadata
${routingStructureLine}    architecture.md       ->  System architecture
    init.sh               ->  Setup AI tool configs
  <feature-slug>/
    specs.md              ->  Technical specification
    requirements.md       ->  Acceptance criteria
${enableTdd ? "    tdd-tests.md          ->  TDD test specifications\n" : ""}    prompt.md             ->  Implementation prompt
\`\`\`

## AI Tool Setup

Run the init script to configure your AI tools automatically:

\`\`\`bash
bash ./specs/.devx/init.sh
\`\`\`

If you want execute permissions as well:

\`\`\`bash
chmod +x ./specs/.devx/init.sh && ./specs/.devx/init.sh
\`\`\`

The script lists supported AI tools, lets you choose one, and creates only that tool's config files.
`;
}

function generateWorkflowMd(enableTdd: boolean): string {
  const tddSection = enableTdd
    ? `
## TDD Workflow (Enabled)

For every acceptance criterion, follow the **Red  ->  Green  ->  Refactor** cycle:

### Phase 1  -  Red (Write Failing Tests)
1. Read the \`tdd-tests.md\` for the feature
2. Write a failing test that maps to a spec-defined behavior
3. Ensure the test fails for the right reason
4. Do NOT write production code before the test fails

### Phase 2  -  Green (Make Tests Pass)
1. Write the minimum code required to pass each failing test
2. Do NOT add untested or extra logic
3. Run the full test suite  -  all tests must pass

### Phase 3  -  Refactor (Clean Up)
1. Improve code structure while keeping all tests passing
2. Apply SOLID, DRY, and Clean Architecture principles
3. Extract reusable abstractions only when a pattern appears >=  3 times (Rule of Three)
4. Run the test suite after every refactor step  -  it must stay green

Repeat this cycle for each acceptance criterion in sequence.
`
    : "";

  return `# Development Workflow

> Spec-Driven Development (SDD)${enableTdd ? " + Test-Driven Development (TDD)" : ""} workflow guide.

## How to Implement a Feature

### Step 1  -  Understand the Spec
1. Open the feature's \`specs.md\`
2. Read the Summary, Key Features, and Functional Requirements
3. Review the User Scenarios for expected behavior

### Step 2  -  Review Requirements
1. Open \`requirements.md\`
2. This is your acceptance criteria checklist
3. Every item must pass before the feature is considered complete

### Step 3  -  Implement
1. Open \`prompt.md\`  -  paste it into your AI assistant for guided implementation
2. For microservices, review \`specs/.devx/feature-routing.json\` and \`specs/.devx/workspace-repos.json\`
3. Follow the specification exactly  -  do not add features not in the spec
4. Implement one requirement at a time
${enableTdd ? "5. Follow the TDD cycle for each requirement (see below)\n" : ""}
### Step 4  -  Validate
1. Go through \`requirements.md\` line by line
2. Check each acceptance criterion
3. Ensure all edge cases from the spec are handled

### Step 5  -  Submit
1. Create a PR with the implementation
2. Reference the spec file in the PR description
3. Include the requirements checklist with pass/fail status
${tddSection}
## Rules

- **Do not deviate from the spec.** If the spec is wrong, update the spec first.
- **One feature at a time.** Complete and validate before moving to the next.
- **Requirements are the source of truth** for what "done" means.
- **Every PR must reference** the spec and requirements it implements.
`;
}

function generateFeaturesJson(
  features: SpecsGenerationFeature[],
  results: SpecsGenerationResult[],
  enableTdd: boolean,
): string {
  const featureEntries = features.map((f) => {
    const result = results.find((r) => r.featureId === f.id);
    const slug =
      f.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `feature-${f.id}`;

    return {
      id: f.id,
      taskId: `FEATURE-${f.id}`,
      title: f.title,
      slug,
      state: f.state || "planned",
      status: "not-started",
      storyCount: f.userStories.length,
      totalStoryPoints: f.userStories.reduce(
        (sum, s) => sum + (s.storyPoints ?? 0),
        0,
      ),
      files: {
        specs: `specs/${slug}/specs.md`,
        requirements: `specs/${slug}/requirements.md`,
        ...(enableTdd && result?.tddTestsContent
          ? { tddTests: `specs/${slug}/tdd-tests.md` }
          : {}),
        prompt: `specs/${slug}/prompt.md`,
      },
      userStories: f.userStories.map((s) => ({
        id: s.id,
        title: s.title,
        state: s.state,
        storyPoints: s.storyPoints,
      })),
    };
  });

  return JSON.stringify(
    {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      enableTdd,
      totalFeatures: features.length,
      features: featureEntries,
    },
    null,
    2,
  );
}

function generateTrackerJson(features: SpecsGenerationFeature[]): string {
  const generatedAt = new Date().toISOString();
  const tasks = Object.fromEntries(
    features.map((feature) => [
      `FEATURE-${feature.id}`,
      {
        status: "PENDING",
        title: feature.title,
        featureId: feature.id,
        slug: slugifyFeatureTitle(feature.title, feature.id),
        updatedAt: generatedAt,
      },
    ]),
  );

  return JSON.stringify(
    {
      trackerVersion: 1,
      updatedAt: generatedAt,
      tasks,
    },
    null,
    2,
  );
}

function generateGenerationJson(features: SpecsGenerationFeature[]): string {
  const generatedAt = new Date().toISOString();

  return JSON.stringify(
    {
      generationId: `GEN-${Date.now()}`,
      generatedAt,
      trackerVersion: 1,
      taskCount: features.length,
    },
    null,
    2,
  );
}

function generateArchitectureMd(
  projectName: string,
  features: SpecsGenerationFeature[],
  architectureStyle: "monolith" | "microservices",
): string {
  const featureMap = features
    .map(
      (f) =>
        `### ${f.title}\n- ${f.userStories.length} user stories\n- Stories: ${f.userStories.map((s) => s.title).join(", ")}`,
    )
    .join("\n\n");

  return `# Architecture  -  ${projectName}

> Auto-generated architecture overview. Update this file as the system evolves.

## Feature Map

${featureMap}

## Guidelines

- Follow the specs in each feature folder for implementation details
- Each feature should be independently deployable where possible
- Shared logic should be extracted into common modules
- Follow the project's established patterns and conventions

${architectureStyle === "microservices"
    ? `## Workspace Discovery Snapshot

- Run \`bash specs/.devx/discover-workspace.sh\` inside the cloned target workspace
- Review \`specs/.devx/feature-routing.json\` for feature-level repo recommendations
- Review \`specs/.devx/workspace-repos.json\` for discovered repositories
- Review \`specs/.devx/workspace-context.md\` for a human summary
- Record any future repos in \`specs/.devx/repo-plans.json\`
`
    : ""}
## Data Models

> Document key data models here as they are implemented.

## API Contracts

> Document API endpoints here as they are implemented.

## Integration Points

> Document external integrations and dependencies here.
`;
}

function generateInstructionMd(
  architectureStyle: "monolith" | "microservices",
  deliveryOrder: "ui-first" | "api-first" | null,
  today: string,
): string {
  const modeSummary = architectureStyle === "microservices"
    ? `This project is configured as **Microservices** with **${deliveryOrder === "api-first" ? "API-first" : "UI-first"}** specs home.`
    : "This project is configured as **Monolithic** architecture.";

  const specsHomeGuidance = architectureStyle === "microservices"
    ? deliveryOrder === "api-first"
      ? "- Specs home is the **API repository** (`specs/` + `specs/.devx/`).\n- UI and other service repos consume specs from the API-first source of truth."
      : "- Specs home is the **UI repository** (`specs/` + `specs/.devx/`).\n- API and other service repos consume specs from the UI-first source of truth."
    : "- Specs and implementation stay in the same repository.\n- Use existing spec-to-code flow without multi-repo routing rules.";

  const workspaceGuidance = architectureStyle === "microservices"
    ? `## Workspace Discovery Files

- \`specs/.devx/discover-workspace.sh\`  -  run this in the cloned target workspace
- \`specs/.devx/feature-routing.json\`  -  generated feature-level owner and impacted repo suggestions
- \`specs/.devx/workspace-repos.json\`  -  discovered repositories, capabilities, and brownfield context
- \`specs/.devx/workspace-context.md\`  -  human-readable workspace summary
- \`specs/.devx/repo-plans.json\`  -  proposed or approved future repositories

### Recommended sequence

1. Push generated specs to the chosen specs-home repo
2. Clone or open the target implementation workspace locally
3. Run \`bash specs/.devx/discover-workspace.sh\`
4. Review \`specs/.devx/feature-routing.json\` against the discovered workspace inventory
5. Update repo ownership or add repo plan proposals before implementation starts
`
    : "";

  return `# Development Instructions

> Last updated: ${today}
> This file is regenerated during specs generation. Keep inventory updates in version control and restore any manual edits after regeneration.

## Active Configuration

${modeSummary}

## Architecture Mode Rules

- **Monolithic**: Existing specs-to-code flow remains unchanged. All feature specs stay under \`specs/<feature-slug>/\` in the implementation repo.
- **Microservices / Multi-repo**: All generated specs still live in one selected specs home repo. Other repos should reference these specs; do not fork spec sources.

## Specs Home by Delivery Order

${specsHomeGuidance}

${workspaceGuidance}## Repository Inventory

| Repository | Purpose | URL | Default Branch | Notes |
| --- | --- | --- | --- | --- |
| _Populate by running discover-workspace.sh in the target workspace_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## Existing APIs

| API / Route | Method | Owning Service/Repo | Notes |
| --- | --- | --- | --- |
| _Populate by running discover-workspace.sh in the target workspace_ | _TBD_ | _TBD_ | _TBD_ |

## Existing UI Screens

| Screen | Route/Path | Owning Repo | Notes |
| --- | --- | --- | --- |
| _Populate by running discover-workspace.sh in the target workspace_ | _TBD_ | _TBD_ | _TBD_ |

## New Feature Routing Decision

When a new feature is requested in microservices mode:

1. Check this inventory and current specs to identify the nearest existing microservice.
2. Decide whether to:
   - Extend an existing microservice with additional APIs/contracts, or
   - Create a new microservice when ownership, deployability, and domain boundaries require it.
3. Record the decision in the feature \`specs.md\` and linked work item before implementation starts.
`;
}

function generateInitScript(): string {
  return [
    "#!/bin/bash",
    "# Astra DevX Init Orchestrator",
    "#",
    "# Usage:",
    "#   bash specs/.devx/init.sh [tool]",
    "#   bash specs/.devx/init.sh --dry-run",
    "#   bash specs/.devx/init.sh --yes codex",
    "#   bash specs/.devx/init.sh --only ai --list-tools",
    "",
    "set -Eeuo pipefail",
    "",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
    "REPO_ROOT=\"$(cd \"$SCRIPT_DIR/../..\" && pwd)\"",
    "DEVX_DIR=\"$SCRIPT_DIR\"",
    "CONFIG_FILE=\"$DEVX_DIR/config.json\"",
    "WORKSPACE_CONTEXT_FILE=\"$DEVX_DIR/workspace-context.md\"",
    "LOCK_FILE=\"$DEVX_DIR/init.lock\"",
    "LOG_DIR=\"$DEVX_DIR/logs\"",
    "TMP_DIR=\"$DEVX_DIR/tmp\"",
    "RUN_ID=\"$(date -u +%Y%m%dT%H%M%SZ)\"",
    "LOG_FILE=\"$LOG_DIR/init-$RUN_ID.log\"",
    "",
    "DRY_RUN=0",
    "YES=0",
    "FORCE=0",
    "FORCE_LOCK=0",
    "DEBUG=0",
    "RESET_CONFIG=0",
    "SKIP_VALIDATION=0",
    "ONLY=\"\"",
    "SELECTED_TOOL=\"\"",
    "STEP_RESULTS=\"\"",
    "REACT_POST_CREATE=\"ask\"",
    "",
    "AVAILABLE_TOOLS=(\"claude\" \"codex\" \"cursor\" \"copilot\" \"windsurf\" \"cline\" \"kiro\")",
    "",
    "if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ \"$(tput colors 2>/dev/null || printf 0)\" -ge 8 ]; then",
    "  C_RESET=\"$(tput sgr0)\"",
    "  C_BOLD=\"$(tput bold)\"",
    "  C_DIM=\"$(tput dim 2>/dev/null || true)\"",
    "  C_BLUE=\"$(tput setaf 4)\"",
    "  C_CYAN=\"$(tput setaf 6)\"",
    "  C_GREEN=\"$(tput setaf 2)\"",
    "  C_YELLOW=\"$(tput setaf 3)\"",
    "  C_RED=\"$(tput setaf 1)\"",
    "  C_MAGENTA=\"$(tput setaf 5)\"",
    "else",
    "  C_RESET=\"\"; C_BOLD=\"\"; C_DIM=\"\"; C_BLUE=\"\"; C_CYAN=\"\"; C_GREEN=\"\"; C_YELLOW=\"\"; C_RED=\"\"; C_MAGENTA=\"\"",
    "fi",
    "",
    "log_line() {",
    "  local level=\"$1\"",
    "  shift",
    "  local message=\"$*\"",
    "  printf '[%s] [%s] %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$level\" \"$message\" >> \"$LOG_FILE\"",
    "  case \"$level\" in",
    "    DEBUG) [ \"$DEBUG\" = \"1\" ] && printf '%s[debug]%s %s\\n' \"$C_DIM\" \"$C_RESET\" \"$message\" ;;",
    "    WARN) printf '%s[warn]%s %s\\n' \"$C_YELLOW\" \"$C_RESET\" \"$message\" ;;",
    "    ERROR) printf '%s[error]%s %s\\n' \"$C_RED\" \"$C_RESET\" \"$message\" ;;",
    "    SUCCESS) printf '%s[ok]%s %s\\n' \"$C_GREEN\" \"$C_RESET\" \"$message\" ;;",
    "    PHASE) printf '\\n%s%s==>%s %s\\n' \"$C_BOLD\" \"$C_CYAN\" \"$C_RESET\" \"$message\" ;;",
    "    PROGRESS) printf '%s[*]%s %s\\n' \"$C_BLUE\" \"$C_RESET\" \"$message\" ;;",
    "    *) printf '%s\\n' \"$message\" ;;",
    "  esac",
    "  return 0",
    "}",
    "",
    "info() { log_line INFO \"$@\"; }",
    "warn() { log_line WARN \"$@\"; }",
    "error() { log_line ERROR \"$@\"; }",
    "debug() { log_line DEBUG \"$@\"; }",
    "success() { log_line SUCCESS \"$@\"; }",
    "phase() { log_line PHASE \"$@\"; }",
    "progress() { log_line PROGRESS \"$@\"; }",
    "",
    "print_banner() {",
    "  printf '\\n'",
    "  printf '%s%s\\n' \"$C_BLUE\" '     ___        _______.___________. .______          ___      '",
    "  printf '%s%s\\n' \"$C_BLUE\" '    /   \\\\      /       |           | |   _  \\\\        /   \\\\     '",
    "  printf '%s%s\\n' \"$C_BLUE\" '   /  ^  \\\\    |   (----`---|  |----` |  |_)  |      /  ^  \\\\    '",
    "  printf '%s%s\\n' \"$C_CYAN\" '  /  /_\\\\  \\\\    \\\\   \\\\       |  |      |      /      /  /_\\\\  \\\\   '",
    "  printf '%s%s\\n' \"$C_CYAN\" ' /  _____  \\\\ .----)   |      |  |      |  |\\\\  \\\\----./  _____  \\\\  '",
    "  printf '%s%s%s\\n' \"$C_CYAN\" '/__/     \\\\__\\\\|_______/       |__|      | _| `._____/__/     \\\\__\\\\ ' \"$C_RESET\"",
    "  printf '%s%s%s\\n' \"$C_BOLD$C_CYAN\" '             DEVX INIT ORCHESTRATOR' \"$C_RESET\"",
    "  printf '%s%s%s\\n' \"$C_DIM\" '             Spec-driven workspace bootstrap' \"$C_RESET\"",
    "  printf '%s%s\\n' \"$C_CYAN\" '----------------------------------------------------------------'",
    "  printf '%sRun id:%s %s\\n' \"$C_DIM\" \"$C_RESET\" \"$RUN_ID\"",
    "  printf '%sLog:%s    %s\\n\\n' \"$C_DIM\" \"$C_RESET\" \"$LOG_FILE\"",
    "  printf '[%s] [INFO] Astra DevX Init Orchestrator\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" >> \"$LOG_FILE\"",
    "  printf '[%s] [INFO] Run id: %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$RUN_ID\" >> \"$LOG_FILE\"",
    "  printf '[%s] [INFO] Log: %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$LOG_FILE\" >> \"$LOG_FILE\"",
    "}",
    "",
    "print_kv() {",
    "  local key=\"$1\"",
    "  local value=\"$2\"",
    "  printf '  %s%-18s%s %s\\n' \"$C_DIM\" \"$key:\" \"$C_RESET\" \"$value\"",
    "  printf '[%s] [INFO] %s: %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$key\" \"$value\" >> \"$LOG_FILE\"",
    "}",
    "",
    "cleanup_lock() {",
    "  if [ -f \"$LOCK_FILE\" ] && grep -q \"$$\" \"$LOCK_FILE\" 2>/dev/null; then",
    "    rm -f \"$LOCK_FILE\"",
    "  fi",
    "}",
    "",
    "on_interrupt() {",
    "  warn \"Init interrupted. Preserving logs at $LOG_FILE\"",
    "  if [ \"$DRY_RUN\" = \"0\" ]; then",
    "    write_config \"cancelled\" || true",
    "  fi",
    "  cleanup_lock",
    "  exit 130",
    "}",
    "",
    "trap cleanup_lock EXIT",
    "trap on_interrupt INT TERM",
    "",
    "usage() {",
    "  cat <<'USAGE'",
    "Astra DevX init",
    "",
    "Options:",
    "  --dry-run              Show planned actions without executing scaffold/config writes",
    "  --yes                  Use safe defaults and skip confirmations",
    "  --force                Allow overwriting generated targets after preview",
    "  --force-lock           Replace a stale init lock",
    "  --debug                Print detection and execution debug details",
    "  --only <scope>         Run only ui, backend, database, ai, or discovery",
    "  --skip validation      Skip post-scaffold validation",
    "  --reset-devx-config    Reset specs/.devx/config.json before running",
    "  --list-tools, --list   List AI tools",
    "  -h, --help             Show help",
    "",
    "Examples:",
    "  bash specs/.devx/init.sh --dry-run",
    "  bash specs/.devx/init.sh --yes codex",
    "  bash specs/.devx/init.sh --only ai claude",
    "USAGE",
    "}",
    "",
    "tool_label() {",
    "  case \"$1\" in",
    "    claude) printf \"Claude Code\" ;;",
    "    codex) printf \"Codex\" ;;",
    "    cursor) printf \"Cursor\" ;;",
    "    copilot) printf \"GitHub Copilot\" ;;",
    "    windsurf) printf \"Windsurf\" ;;",
    "    cline) printf \"Cline\" ;;",
    "    kiro) printf \"Kiro\" ;;",
    "    *) printf \"%s\" \"$1\" ;;",
    "  esac",
    "}",
    "",
    "print_tools() {",
    "  printf '%sAvailable AI tools:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "  local index=1",
    "  for tool in \"${AVAILABLE_TOOLS[@]}\"; do",
    "    printf '  %s%2s)%s %-18s %s[%s]%s\\n' \"$C_CYAN\" \"$index\" \"$C_RESET\" \"$(tool_label \"$tool\")\" \"$C_DIM\" \"$tool\" \"$C_RESET\"",
    "    index=$((index + 1))",
    "  done",
    "}",
    "",
    "MENU_ACTION=\"\"",
    "MENU_ESCAPE_TAIL=\"\"",
    "read_menu_escape_tail() {",
    "  local rest next",
    "  rest=\"\"",
    "  IFS= read -r -s -n2 rest 2>/dev/null || rest=\"\"",
    "  while [[ \"$rest\" =~ [0-9\\;]$ ]] && IFS= read -r -s -n1 -t 1 next 2>/dev/null; do",
    "    rest=\"$rest$next\"",
    "    case \"$next\" in [A-Za-z~]) break ;; esac",
    "    [ \"${#rest}\" -ge 12 ] && break",
    "  done",
    "  MENU_ESCAPE_TAIL=\"$rest\"",
    "}",
    "",
    "read_menu_key() {",
    "  local key rest",
    "  MENU_ACTION=\"other\"",
    "  IFS= read -r -s -n1 key 2>/dev/null || key=\"\"",
    "  case \"$key\" in",
    "    '') MENU_ACTION='enter' ;;",
    "    ' ') MENU_ACTION='enter' ;;",
    "    $'\\r'|$'\\n') MENU_ACTION='enter' ;;",
    "    $'\\x1b')",
    "      read_menu_escape_tail",
    "      rest=\"$MENU_ESCAPE_TAIL\"",
    "      case \"$rest\" in",
    "        *A) MENU_ACTION='up' ;;",
    "        *B) MENU_ACTION='down' ;;",
    "        *) MENU_ACTION='escape' ;;",
    "      esac",
    "      ;;",
    "    k|K|w|W) MENU_ACTION='up' ;;",
    "    j|J|s|S) MENU_ACTION='down' ;;",
    "    [0-9]) MENU_ACTION=\"number:$key\" ;;",
    "    *) MENU_ACTION='other' ;;",
    "  esac",
    "}",
    "",
    "MENU_TTY_STATE=\"\"",
    "MENU_PREV_EXIT_TRAP=\"\"",
    "MENU_PREV_INT_TRAP=\"\"",
    "MENU_PREV_TERM_TRAP=\"\"",
    "restore_menu_tty() {",
    "  if [ -n \"${MENU_TTY_STATE:-}\" ]; then",
    "    stty \"$MENU_TTY_STATE\" 2>/dev/null || true",
    "    MENU_TTY_STATE=\"\"",
    "  fi",
    "}",
    "",
    "restore_menu_traps() {",
    "  if [ -n \"$MENU_PREV_EXIT_TRAP\" ]; then eval \"$MENU_PREV_EXIT_TRAP\"; else trap - EXIT; fi",
    "  if [ -n \"$MENU_PREV_INT_TRAP\" ]; then eval \"$MENU_PREV_INT_TRAP\"; else trap - INT; fi",
    "  if [ -n \"$MENU_PREV_TERM_TRAP\" ]; then eval \"$MENU_PREV_TERM_TRAP\"; else trap - TERM; fi",
    "}",
    "",
    "abort_menu() {",
    "  restore_menu_tty",
    "  printf '\\n'",
    "  exit 130",
    "}",
    "",
    "choose_menu() {",
    "  local title=\"$1\"",
    "  local default_index=\"$2\"",
    "  shift 2",
    "  local options=(\"$@\")",
    "  local count=\"${#options[@]}\"",
    "  local action key starts_at_zero=0",
    "  MENU_CHOICE_INDEX=\"$default_index\"",
    "  [ \"$MENU_CHOICE_INDEX\" -lt 0 ] && MENU_CHOICE_INDEX=0",
    "  [ \"$MENU_CHOICE_INDEX\" -ge \"$count\" ] && MENU_CHOICE_INDEX=$((count - 1))",
    "  [ \"$count\" -le 0 ] && return 1",
    "  case \"${options[0]}\" in 0\\)*) starts_at_zero=1 ;; esac",
    "",
    "  printf '\\n%s%s%s\\n' \"$C_BOLD\" \"$title\" \"$C_RESET\"",
    "  if [ ! -t 0 ]; then",
    "    local i typed",
    "    for i in \"${!options[@]}\"; do",
    "      printf '  %s\\n' \"${options[$i]}\"",
    "    done",
    "    printf 'Choice: '",
    "    read -r typed",
    "    if [ \"$starts_at_zero\" = \"1\" ] && [[ \"$typed\" =~ ^[0-9]+$ ]] && [ \"$typed\" -ge 0 ] && [ \"$typed\" -lt \"$count\" ]; then",
    "      MENU_CHOICE_INDEX=\"$typed\"",
    "    elif [[ \"$typed\" =~ ^[0-9]+$ ]] && [ \"$typed\" -ge 1 ] && [ \"$typed\" -le \"$count\" ]; then",
    "      MENU_CHOICE_INDEX=$((typed - 1))",
    "    fi",
    "    return 0",
    "  fi",
    "",
    "  printf '%sUse Up/Down arrows, j/k, w/s, and Enter/Space, or press a number.%s\\n' \"$C_DIM\" \"$C_RESET\"",
    "  MENU_TTY_STATE=\"$(stty -g 2>/dev/null || true)\"",
    "  if [ -n \"$MENU_TTY_STATE\" ]; then",
    "    MENU_PREV_EXIT_TRAP=\"$(trap -p EXIT)\"",
    "    MENU_PREV_INT_TRAP=\"$(trap -p INT)\"",
    "    MENU_PREV_TERM_TRAP=\"$(trap -p TERM)\"",
    "    stty -echo -icanon min 1 time 0 2>/dev/null || true",
    "    trap restore_menu_tty EXIT",
    "    trap abort_menu INT TERM",
    "  fi",
    "  while true; do",
    "    local i",
    "    for i in \"${!options[@]}\"; do",
    "      if [ \"$i\" -eq \"$MENU_CHOICE_INDEX\" ]; then",
    "        printf '  %s> %s%s\\n' \"$C_CYAN$C_BOLD\" \"${options[$i]}\" \"$C_RESET\"",
    "      else",
    "        printf '    %s\\n' \"${options[$i]}\"",
    "      fi",
    "    done",
    "",
    "    read_menu_key",
    "    action=\"$MENU_ACTION\"",
    "    case \"$action\" in",
    "      enter) break ;;",
    "      up) MENU_CHOICE_INDEX=$(( (MENU_CHOICE_INDEX + count - 1) % count )) ;;",
    "      down) MENU_CHOICE_INDEX=$(( (MENU_CHOICE_INDEX + 1) % count )) ;;",
    "      number:*)",
    "        key=\"${action#number:}\"",
    "        if [ \"$starts_at_zero\" = \"1\" ] && [ \"$key\" -ge 0 ] && [ \"$key\" -lt \"$count\" ]; then",
    "          MENU_CHOICE_INDEX=\"$key\"",
    "          break",
    "        elif [ \"$key\" -ge 1 ] && [ \"$key\" -le \"$count\" ]; then",
    "          MENU_CHOICE_INDEX=$((key - 1))",
    "          break",
    "        fi",
    "        ;;",
    "    esac",
    "    printf '\\033[%sA\\033[J' \"$count\"",
    "  done",
    "  restore_menu_tty",
    "  restore_menu_traps",
    "  printf '\\033[%sA\\033[J' \"$count\"",
    "  printf '  %s> %s%s\\n' \"$C_GREEN$C_BOLD\" \"${options[$MENU_CHOICE_INDEX]}\" \"$C_RESET\"",
    "}",
    "",
    "normalize_tool_choice() {",
    "  local raw",
    "  raw=\"$(printf '%s' \"$1\" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//; s/ *$//; s/[ _-]//g')\"",
    "  case \"$raw\" in",
    "    1|claude|claudecode) printf \"claude\" ;;",
    "    2|codex|openaicodex) printf \"codex\" ;;",
    "    3|cursor) printf \"cursor\" ;;",
    "    4|copilot|githubcopilot|github) printf \"copilot\" ;;",
    "    5|windsurf) printf \"windsurf\" ;;",
    "    6|cline) printf \"cline\" ;;",
    "    7|kiro) printf \"kiro\" ;;",
    "    *) printf \"\" ;;",
    "  esac",
    "}",
    "",
    "while [ \"$#\" -gt 0 ]; do",
    "  case \"$1\" in",
    "    --dry-run) DRY_RUN=1 ;;",
    "    --yes|-y) YES=1 ;;",
    "    --force) FORCE=1 ;;",
    "    --force-lock) FORCE_LOCK=1 ;;",
    "    --debug) DEBUG=1 ;;",
    "    --only)",
    "      shift",
    "      ONLY=\"${1:-}\"",
    "      ;;",
    "    --skip)",
    "      shift",
    "      if [ \"${1:-}\" = \"validation\" ]; then",
    "        SKIP_VALIDATION=1",
    "      else",
    "        error \"Unsupported --skip value: ${1:-}\"",
    "        exit 1",
    "      fi",
    "      ;;",
    "    --reset-devx-config) RESET_CONFIG=1 ;;",
    "    --list|--list-tools|-l)",
    "      print_tools",
    "      exit 0",
    "      ;;",
    "    --help|-h)",
    "      usage",
    "      exit 0",
    "      ;;",
    "    -*)",
    "      error \"Unknown option: $1\"",
    "      usage",
    "      exit 1",
    "      ;;",
    "    *)",
    "      if [ -z \"$SELECTED_TOOL\" ]; then",
    "        SELECTED_TOOL=\"$(normalize_tool_choice \"$1\")\"",
    "      else",
    "        warn \"Ignoring extra argument: $1\"",
    "      fi",
    "      ;;",
    "  esac",
    "  shift",
    "done",
    "",
    "if [ -z \"$SELECTED_TOOL\" ]; then",
    "  SELECTED_TOOL=\"$(normalize_tool_choice \"${AI_TOOL:-}\")\"",
    "fi",
    "",
    "if [ -n \"$ONLY\" ]; then",
    "  case \"$ONLY\" in",
    "    ui|backend|database|ai|discovery) ;;",
    "    *) error \"--only must be ui, backend, database, ai, or discovery\"; exit 1 ;;",
    "  esac",
    "fi",
    "",
    "if [ \"$DRY_RUN\" = \"1\" ]; then",
    "  LOG_DIR=\"${TMPDIR:-/tmp}/devx-init-logs\"",
    "  TMP_DIR=\"${TMPDIR:-/tmp}/devx-init-tmp\"",
    "  LOCK_FILE=\"${TMPDIR:-/tmp}/devx-init-$RUN_ID.lock\"",
    "  LOG_FILE=\"$LOG_DIR/init-$RUN_ID.log\"",
    "fi",
    "",
    "mkdir -p \"$LOG_DIR\" \"$TMP_DIR\"",
    "",
    "if [ \"$RESET_CONFIG\" = \"1\" ] && [ \"$DRY_RUN\" = \"0\" ]; then",
    "  rm -f \"$CONFIG_FILE\"",
    "fi",
    "",
    "if [ -f \"$LOCK_FILE\" ]; then",
    "  if [ \"$FORCE_LOCK\" = \"1\" ]; then",
    "    warn \"Replacing existing init lock at $LOCK_FILE\"",
    "    rm -f \"$LOCK_FILE\"",
    "  else",
    "    error \"Another DevX init appears to be running. Remove $LOCK_FILE or use --force-lock if it is stale.\"",
    "    exit 1",
    "  fi",
    "fi",
    "printf 'pid=%s\\nrunId=%s\\nstartedAt=%s\\n' \"$$\" \"$RUN_ID\" \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > \"$LOCK_FILE\"",
    "",
    "if [[ \"$OSTYPE\" == msys* || \"$OSTYPE\" == cygwin* ]]; then",
    "  warn \"Windows shell detected. DevX works best in WSL/macOS/Linux; some discovery and validation steps are skipped in Git Bash due fork instability.\"",
    "fi",
    "",
    "print_banner",
    "",
    "if [ -z \"$SELECTED_TOOL\" ]; then",
    "  TOOL_OPTIONS=()",
    "  tool_index=1",
    "  for tool in \"${AVAILABLE_TOOLS[@]}\"; do",
    "    TOOL_OPTIONS+=(\"$tool_index) $(tool_label \"$tool\") [$tool]\")",
    "    tool_index=$((tool_index + 1))",
    "  done",
    "  choose_menu \"Available AI tools\" 0 \"${TOOL_OPTIONS[@]}\"",
    "  SELECTED_TOOL=\"${AVAILABLE_TOOLS[$MENU_CHOICE_INDEX]}\"",
    "fi",
    "",
    "if [ -z \"$SELECTED_TOOL\" ]; then",
    "  error \"Unknown AI tool selection. Run with --list-tools to see supported tools.\"",
    "  exit 1",
    "fi",
    "",
    "success \"Selected AI tool: $(tool_label \"$SELECTED_TOOL\")\"",
    "",
    "command_exists() {",
    "  command -v \"$1\" >/dev/null 2>&1",
    "}",
    "",
    "safe_version() {",
    "  local command_name=\"$1\"",
    "  if command_exists \"$command_name\"; then",
    "    \"$command_name\" --version 2>/dev/null | head -n 1 | tr -d '\"'",
    "  else",
    "    printf \"missing\"",
    "  fi",
    "}",
    "",
    "detect_package_manager() {",
    "  if [ -f \"$REPO_ROOT/pnpm-lock.yaml\" ] || [ -f \"$REPO_ROOT/pnpm-workspace.yaml\" ]; then",
    "    printf \"pnpm\"",
    "  elif [ -f \"$REPO_ROOT/yarn.lock\" ]; then",
    "    printf \"yarn\"",
    "  elif [ -f \"$REPO_ROOT/bun.lockb\" ] || [ -f \"$REPO_ROOT/bun.lock\" ]; then",
    "    printf \"bun\"",
    "  else",
    "    printf \"npm\"",
    "  fi",
    "}",
    "",
    "pm_create() {",
    "  case \"$PACKAGE_MANAGER\" in",
    "    pnpm) printf \"pnpm create\" ;;",
    "    yarn) printf \"yarn create\" ;;",
    "    bun) printf \"bun create\" ;;",
    "    *) printf \"npm create\" ;;",
    "  esac",
    "}",
    "",
    "pm_install() {",
    "  case \"$PACKAGE_MANAGER\" in",
    "    pnpm) printf \"pnpm install\" ;;",
    "    yarn) printf \"yarn install\" ;;",
    "    bun) printf \"bun install\" ;;",
    "    *) printf \"npm install\" ;;",
    "  esac",
    "}",
    "",
    "pm_run() {",
    "  case \"$PACKAGE_MANAGER\" in",
    "    pnpm) printf \"pnpm\" ;;",
    "    yarn) printf \"yarn\" ;;",
    "    bun) printf \"bun\" ;;",
    "    *) printf \"npm run\" ;;",
    "  esac",
    "}",
    "",
    "json_escape() {",
    "  printf '%s' \"$1\" | sed 's/\\\\/\\\\\\\\/g' | sed 's/\"/\\\\\"/g'",
    "}",
    "",
    "score_has_file() {",
    "  local points=\"$1\"",
    "  shift",
    "  local pattern",
    "  for pattern in \"$@\"; do",
    "    if find \"$REPO_ROOT\" -maxdepth 4 -path \"$REPO_ROOT/specs/.devx\" -prune -o -name \"$pattern\" -print -quit | grep -q .; then",
    "      printf \"%s\" \"$points\"",
    "      return",
    "    fi",
    "  done",
    "  printf \"0\"",
    "}",
    "",
    "score_has_path() {",
    "  local points=\"$1\"",
    "  shift",
    "  local path",
    "  for path in \"$@\"; do",
    "    if [ -e \"$REPO_ROOT/$path\" ]; then",
    "      printf \"%s\" \"$points\"",
    "      return",
    "    fi",
    "  done",
    "  printf \"0\"",
    "}",
    "",
    "score_has_text() {",
    "  local points=\"$1\"",
    "  local pattern=\"$2\"",
    "  local files",
    "  files=\"$(find \"$REPO_ROOT\" -maxdepth 4 -name package.json -not -path \"*/node_modules/*\" -not -path \"*/specs/.devx/*\" -print 2>/dev/null)\"",
    "  if [ -n \"$files\" ] && printf '%s\\n' \"$files\" | xargs grep -E \"$pattern\" >/dev/null 2>&1; then",
    "    printf \"%s\" \"$points\"",
    "  else",
    "    printf \"0\"",
    "  fi",
    "}",
    "",
    "classify_score() {",
    "  local score=\"$1\"",
    "  local conflict=\"$2\"",
    "  if [ \"$conflict\" = \"1\" ]; then",
    "    printf \"conflict\"",
    "  elif [ \"$score\" -ge 80 ]; then",
    "    printf \"detected\"",
    "  elif [ \"$score\" -ge 40 ]; then",
    "    printf \"partial\"",
    "  else",
    "    printf \"missing\"",
    "  fi",
    "}",
    "",
    "resolve_top_stack() {",
    "  local layer=\"$1\"",
    "  shift",
    "  local best_stack=\"none\"",
    "  local best_score=0",
    "  local second_score=0",
    "  local item stack score",
    "  for item in \"$@\"; do",
    "    stack=\"${item%%:*}\"",
    "    score=\"${item##*:}\"",
    "    if [ \"$score\" -gt \"$best_score\" ]; then",
    "      second_score=\"$best_score\"",
    "      best_score=\"$score\"",
    "      best_stack=\"$stack\"",
    "    elif [ \"$score\" -gt \"$second_score\" ]; then",
    "      second_score=\"$score\"",
    "    fi",
    "  done",
    "  local conflict=0",
    "  if [ \"$best_score\" -ge 40 ] && [ \"$second_score\" -ge 40 ] && [ $((best_score - second_score)) -le 10 ]; then",
    "    conflict=1",
    "  fi",
    "  printf '%s|%s|%s' \"$best_stack\" \"$best_score\" \"$(classify_score \"$best_score\" \"$conflict\")\"",
    "  debug \"$layer scores: $* => $best_stack $best_score conflict=$conflict\"",
    "}",
    "",
    "detect_workspace() {",
    "  phase \"[1/6] Detect workspace\"",
    "  PACKAGE_MANAGER=\"$(detect_package_manager)\"",
    "",
    "  REACT_SCORE=$(( $(score_has_file 35 vite.config.ts vite.config.js) + $(score_has_text 35 '\"react\"|\"@vitejs/plugin-react\"') + $(score_has_path 20 src/main.tsx src/App.tsx app/page.tsx) + $(score_has_text 10 '\"dev\"') ))",
    "  ANGULAR_SCORE=$(( $(score_has_file 50 angular.json) + $(score_has_text 30 '\"@angular/core\"') + $(score_has_path 20 src/main.ts src/app) ))",
    "  VUE_SCORE=$(( $(score_has_file 35 vite.config.ts vite.config.js vue.config.js) + $(score_has_text 35 '\"vue\"|\"@vitejs/plugin-vue\"') + $(score_has_path 20 src/main.ts src/App.vue) ))",
    "  SVELTE_SCORE=$(( $(score_has_file 45 svelte.config.js svelte.config.ts) + $(score_has_text 35 '\"svelte\"|\"@sveltejs/kit\"') + $(score_has_path 20 src/routes src/app.html) ))",
    "",
    "  NODE_SCORE=$(( $(score_has_text 35 '\"express\"|\"fastify\"|\"@nestjs/core\"') + $(score_has_path 25 server api src/server.ts src/index.ts) + $(score_has_file 20 package.json) + $(score_has_text 20 '\"start\"|\"server\"') ))",
    "  PYTHON_SCORE=$(( $(score_has_file 35 pyproject.toml requirements.txt) + $(score_has_text 35 '\"fastapi\"') + $(score_has_path 20 app/main.py main.py api) ))",
    "  GO_SCORE=$(( $(score_has_file 50 go.mod) + $(score_has_path 25 cmd internal main.go) + $(score_has_file 15 '*.go') ))",
    "  DOTNET_SCORE=$(( $(score_has_file 45 '*.sln' '*.csproj') + $(score_has_path 25 Program.cs Controllers) + $(score_has_text 10 'Microsoft.NET.Sdk.Web') ))",
    "  PHP_SCORE=$(( $(score_has_file 45 composer.json artisan) + $(score_has_path 30 app/Http routes/web.php routes/api.php) ))",
    "  RAILS_SCORE=$(( $(score_has_file 45 Gemfile) + $(score_has_path 30 config/database.yml app/controllers bin/rails) ))",
    "",
    "  MYSQL_SCORE=$(( $(score_has_text 30 'mysql|mysql2|MySql') + $(score_has_path 30 migrations prisma schema.prisma database/migrations) ))",
    "  SQLSERVER_SCORE=$(( $(score_has_text 40 'sqlserver|mssql|SqlServer') + $(score_has_path 20 migrations) ))",
    "  POSTGRES_SCORE=$(( $(score_has_text 35 'postgres|pg|postgresql') + $(score_has_path 20 migrations prisma schema.prisma) ))",
    "  MONGO_SCORE=$(( $(score_has_text 40 'mongodb|mongoose|pymongo') + $(score_has_path 20 models schemas) ))",
    "  ORACLE_SCORE=$(( $(score_has_text 45 'oracle|oracledb|Oracle') ))",
    "",
    "  IFS='|' read -r UI_STACK UI_SCORE UI_STATUS <<< \"$(resolve_top_stack ui \"react:$REACT_SCORE\" \"angular:$ANGULAR_SCORE\" \"vue:$VUE_SCORE\" \"svelte:$SVELTE_SCORE\")\"",
    "  IFS='|' read -r BACKEND_STACK BACKEND_SCORE BACKEND_STATUS <<< \"$(resolve_top_stack backend \"node:$NODE_SCORE\" \"python:$PYTHON_SCORE\" \"go:$GO_SCORE\" \"dotnet:$DOTNET_SCORE\" \"php:$PHP_SCORE\" \"rails:$RAILS_SCORE\")\"",
    "  IFS='|' read -r DB_STACK DB_SCORE DB_STATUS <<< \"$(resolve_top_stack database \"mysql:$MYSQL_SCORE\" \"sqlserver:$SQLSERVER_SCORE\" \"postgres:$POSTGRES_SCORE\" \"mongodb:$MONGO_SCORE\" \"oracle:$ORACLE_SCORE\")\"",
    "",
    "  MONOREPO_MODE=\"single\"",
    "  if [ -f \"$REPO_ROOT/pnpm-workspace.yaml\" ] || [ -f \"$REPO_ROOT/nx.json\" ] || [ -f \"$REPO_ROOT/turbo.json\" ] || [ -f \"$REPO_ROOT/lerna.json\" ] || [ -d \"$REPO_ROOT/apps\" ] || [ -d \"$REPO_ROOT/packages\" ] || [ -d \"$REPO_ROOT/services\" ]; then",
    "    MONOREPO_MODE=\"monorepo\"",
    "  fi",
    "",
    "  NESTED_REPOS=\"$(find \"$REPO_ROOT\" -mindepth 2 -maxdepth 4 -name .git -type d -not -path \"*/node_modules/*\" -not -path \"*/specs/.devx/*\" | sed \"s#^$REPO_ROOT/##\" | sed 's#/.git$##' | tr '\\n' ',' | sed 's/,$//')\"",
    "  CI_MARKERS=\"$(find \"$REPO_ROOT\" -maxdepth 4 \\( -path \"$REPO_ROOT/.github/workflows\" -o -name azure-pipelines.yml -o -name .gitlab-ci.yml -o -name Jenkinsfile -o -name docker-compose.yml \\) -print 2>/dev/null | sed \"s#^$REPO_ROOT/##\" | tr '\\n' ',' | sed 's/,$//')\"",
    "  ENV_MARKERS=\"$(find \"$REPO_ROOT\" -maxdepth 4 \\( -name \".env\" -o -name \".env.example\" -o -name \"appsettings*.json\" \\) -not -path \"*/node_modules/*\" -print 2>/dev/null | sed \"s#^$REPO_ROOT/##\" | tr '\\n' ',' | sed 's/,$//')\"",
    "",
    "  print_kv \"Package manager\" \"$PACKAGE_MANAGER\"",
    "  print_kv \"UI\" \"$UI_STACK ($UI_STATUS, score $UI_SCORE)\"",
    "  print_kv \"Backend\" \"$BACKEND_STACK ($BACKEND_STATUS, score $BACKEND_SCORE)\"",
    "  print_kv \"Database\" \"$DB_STACK ($DB_STATUS, score $DB_SCORE)\"",
    "  print_kv \"Workspace mode\" \"$MONOREPO_MODE\"",
    "  [ -n \"$NESTED_REPOS\" ] && warn \"Nested Git repos/submodules detected: $NESTED_REPOS\"",
    "  return 0",
    "}",
    "",
    "target_for_ui() {",
    "  if [ \"$MONOREPO_MODE\" = \"monorepo\" ]; then",
    "    [ -d \"$REPO_ROOT/apps\" ] && printf \"apps/web\" || printf \"client\"",
    "  else",
    "    printf \"client\"",
    "  fi",
    "}",
    "",
    "target_for_backend() {",
    "  if [ \"$MONOREPO_MODE\" = \"monorepo\" ]; then",
    "    [ -d \"$REPO_ROOT/apps\" ] && printf \"apps/api\" || { [ -d \"$REPO_ROOT/services\" ] && printf \"services/api\" || printf \"server\"; }",
    "  else",
    "    printf \"server\"",
    "  fi",
    "}",
    "",
    "select_missing_layers() {",
    "  phase \"[2/6] Decide setup strategy\"",
    "  SELECT_UI=\"none\"",
    "  SELECT_BACKEND=\"none\"",
    "  SELECT_DB=\"none\"",
    "  NEEDS_USER_DECISION=\"\"",
    "",
    "  if [ \"$UI_STATUS\" = \"missing\" ] && { [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"ui\" ]; }; then",
    "    if [ \"$YES\" = \"1\" ]; then",
    "      SELECT_UI=\"react\"",
    "    else",
    "      choose_menu \"No confident UI setup detected. Choose a UI framework:\" 1 \\",
    "        \"0) None\" \\",
    "        \"1) React (Vite + TypeScript)\" \\",
    "        \"2) Angular (Angular CLI)\" \\",
    "        \"3) Vue (create-vue)\" \\",
    "        \"4) Svelte (sv create)\"",
    "      case \"$MENU_CHOICE_INDEX\" in",
    "        1) SELECT_UI=\"react\" ;;",
    "        2) SELECT_UI=\"angular\" ;;",
    "        3) SELECT_UI=\"vue\" ;;",
    "        4) SELECT_UI=\"svelte\" ;;",
    "        *) SELECT_UI=\"none\" ;;",
    "      esac",
    "    fi",
    "  elif [ \"$UI_STATUS\" = \"conflict\" ]; then",
    "    NEEDS_USER_DECISION=\"$NEEDS_USER_DECISION ui-conflict\"",
    "  fi",
    "",
    "  if [ \"$BACKEND_STATUS\" = \"missing\" ] && { [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"backend\" ]; }; then",
    "    if [ \"$YES\" = \"1\" ]; then",
    "      SELECT_BACKEND=\"node\"",
    "    else",
    "      choose_menu \"No confident backend setup detected. Choose a backend stack:\" 1 \\",
    "        \"0) None\" \\",
    "        \"1) Node.js / Express\" \\",
    "        \"2) Python / FastAPI\" \\",
    "        \"3) Go\" \\",
    "        \"4) .NET Web API\" \\",
    "        \"5) PHP / Laravel\" \\",
    "        \"6) Ruby on Rails\"",
    "      case \"$MENU_CHOICE_INDEX\" in",
    "        1) SELECT_BACKEND=\"node\" ;;",
    "        2) SELECT_BACKEND=\"python\" ;;",
    "        3) SELECT_BACKEND=\"go\" ;;",
    "        4) SELECT_BACKEND=\"dotnet\" ;;",
    "        5) SELECT_BACKEND=\"php\" ;;",
    "        6) SELECT_BACKEND=\"rails\" ;;",
    "        *) SELECT_BACKEND=\"none\" ;;",
    "      esac",
    "    fi",
    "  elif [ \"$BACKEND_STATUS\" = \"conflict\" ]; then",
    "    NEEDS_USER_DECISION=\"$NEEDS_USER_DECISION backend-conflict\"",
    "  fi",
    "",
    "  if [ \"$DB_STATUS\" = \"missing\" ] && { [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"database\" ]; }; then",
    "    if [ \"$YES\" = \"1\" ]; then",
    "      SELECT_DB=\"none\"",
    "    else",
    "      choose_menu \"Choose database configuration guidance:\" 0 \\",
    "        \"0) None\" \\",
    "        \"1) MySQL\" \\",
    "        \"2) SQL Server\" \\",
    "        \"3) PostgreSQL\" \\",
    "        \"4) MongoDB\" \\",
    "        \"5) Oracle\"",
    "      case \"$MENU_CHOICE_INDEX\" in",
    "        1) SELECT_DB=\"mysql\" ;;",
    "        2) SELECT_DB=\"sqlserver\" ;;",
    "        3) SELECT_DB=\"postgres\" ;;",
    "        4) SELECT_DB=\"mongodb\" ;;",
    "        5) SELECT_DB=\"oracle\" ;;",
    "        *) SELECT_DB=\"none\" ;;",
    "      esac",
    "    fi",
    "  fi",
    "",
    "  UI_TARGET=\"$(target_for_ui)\"",
    "  BACKEND_TARGET=\"$(target_for_backend)\"",
    "",
    "  if [ \"$SELECT_UI\" = \"react\" ]; then",
    "    if [ \"$YES\" = \"1\" ]; then",
    "      REACT_POST_CREATE=\"install\"",
    "    else",
    "      choose_menu \"After creating the React app, what should DevX do?\" 1 \\",
    "        \"0) Create files only\" \\",
    "        \"1) Install dependencies (recommended)\" \\",
    "        \"2) Install and start dev server (long-running)\"",
    "      case \"$MENU_CHOICE_INDEX\" in",
    "        0) REACT_POST_CREATE=\"none\" ;;",
    "        2) REACT_POST_CREATE=\"install-start\" ;;",
    "        *) REACT_POST_CREATE=\"install\" ;;",
    "      esac",
    "    fi",
    "  fi",
    "}",
    "",
    "register_steps() {",
    "  STEPS=()",
    "  if [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"ui\" ]; then",
    "    [ \"$SELECT_UI\" != \"none\" ] && STEPS+=(\"scaffold-ui:$SELECT_UI:$UI_TARGET\")",
    "  fi",
    "  if [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"backend\" ]; then",
    "    [ \"$SELECT_BACKEND\" != \"none\" ] && STEPS+=(\"scaffold-backend:$SELECT_BACKEND:$BACKEND_TARGET\")",
    "  fi",
    "  if [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"database\" ]; then",
    "    [ \"$SELECT_DB\" != \"none\" ] && STEPS+=(\"configure-database:$SELECT_DB:.\")",
    "  fi",
    "  if [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"discovery\" ]; then",
    "    STEPS+=(\"workspace-discovery:devx:.\")",
    "  fi",
    "  if [ -z \"$ONLY\" ] || [ \"$ONLY\" = \"ai\" ]; then",
    "    STEPS+=(\"configure-ai:$SELECTED_TOOL:.\")",
    "  fi",
    "}",
    "",
    "step_command() {",
    "  local id=\"$1\"",
    "  local stack=\"$2\"",
    "  local target=\"$3\"",
    "  local create_cmd",
    "  create_cmd=\"$(pm_create)\"",
    "  case \"$id:$stack\" in",
    "    scaffold-ui:react)",
    "      if [ \"${REACT_POST_CREATE:-none}\" = \"install-start\" ]; then",
    "        printf 'printf \"y\\\\n\" | %s vite@latest %s -- --template react-ts' \"$create_cmd\" \"$target\"",
    "      elif [ \"${REACT_POST_CREATE:-none}\" = \"install\" ]; then",
    "        printf 'printf \"n\\\\n\" | %s vite@latest %s -- --template react-ts && cd %s && %s' \"$create_cmd\" \"$target\" \"$target\" \"$(pm_install)\"",
    "      else",
    "        printf 'printf \"n\\\\n\" | %s vite@latest %s -- --template react-ts' \"$create_cmd\" \"$target\"",
    "      fi",
    "      ;;",
    "    scaffold-ui:angular) printf 'npx -y @angular/cli@latest new %s --routing --style css --skip-git --defaults --skip-install' \"$target\" ;;",
    "    scaffold-ui:vue) printf '%s vue@latest %s -- --default --typescript --no-git' \"$create_cmd\" \"$target\" ;;",
    "    scaffold-ui:svelte) printf 'npx -y sv@latest create %s --template minimal --types ts --no-add-ons --no-install' \"$target\" ;;",
    "    scaffold-backend:node) printf 'npx -y express-generator@latest %s --no-view --git' \"$target\" ;;",
    "    scaffold-backend:python) printf 'mkdir -p %s/app && cd %s && python3 -m venv .venv && . .venv/bin/activate && python -m pip install fastapi uvicorn && printf \"from fastapi import FastAPI\\\\n\\\\napp = FastAPI()\\\\n\\\\n@app.get(\\047/health\\047)\\\\ndef health():\\\\n    return {\\047status\\047: \\047ok\\047}\\\\n\" > app/main.py' \"$target\" \"$target\" ;;",
    "    scaffold-backend:go) printf 'mkdir -p %s && cd %s && go mod init example.com/devx-api && printf \"package main\\\\n\\\\nimport (\\\\n  \\042net/http\\042\\\\n)\\\\n\\\\nfunc main() {\\\\n  http.HandleFunc(\\042/health\\042, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(\\042ok\\042)) })\\\\n  http.ListenAndServe(\\042:8080\\042, nil)\\\\n}\\\\n\" > main.go' \"$target\" \"$target\" ;;",
    "    scaffold-backend:dotnet) printf 'dotnet new webapi -o %s --no-restore' \"$target\" ;;",
    "    scaffold-backend:php) printf 'composer create-project laravel/laravel %s' \"$target\" ;;",
    "    scaffold-backend:rails) printf 'rails new %s --skip-git' \"$target\" ;;",
    "    configure-database:*) printf 'configure_database %s' \"$stack\" ;;",
    "    workspace-discovery:*) printf 'bash specs/.devx/discover-workspace.sh' ;;",
    "    configure-ai:*) printf 'configure_ai %s' \"$stack\" ;;",
    "    *) printf '' ;;",
    "  esac",
    "}",
    "",
    "required_tool_for_step() {",
    "  local id=\"$1\"",
    "  local stack=\"$2\"",
    "  case \"$id:$stack\" in",
    "    scaffold-ui:react|scaffold-ui:vue|scaffold-ui:svelte|scaffold-ui:angular|scaffold-backend:node) printf \"node npm\" ;;",
    "    scaffold-backend:python) printf \"python3\" ;;",
    "    scaffold-backend:go) printf \"go\" ;;",
    "    scaffold-backend:dotnet) printf \"dotnet\" ;;",
    "    scaffold-backend:php) printf \"php composer\" ;;",
    "    scaffold-backend:rails) printf \"ruby rails\" ;;",
    "    *) printf \"\" ;;",
    "  esac",
    "}",
    "",
    "validate_required_tools() {",
    "  local id=\"$1\"",
    "  local stack=\"$2\"",
    "  local missing=\"\"",
    "  local tool",
    "  for tool in $(required_tool_for_step \"$id\" \"$stack\"); do",
    "    if ! command_exists \"$tool\"; then",
    "      missing=\"$missing $tool\"",
    "    fi",
    "  done",
    "  if [ -n \"$missing\" ]; then",
    "    warn \"Skipping $id/$stack because required tools are missing:$missing\"",
    "    return 1",
    "  fi",
    "  return 0",
    "}",
    "",
    "preview_plan() {",
    "  phase \"[3/6] Preview plan\"",
    "  printf '%sPlanned DevX actions%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "  print_kv \"Workspace\" \"$MONOREPO_MODE\"",
    "  print_kv \"Package manager\" \"$PACKAGE_MANAGER\"",
    "  print_kv \"Detected UI\" \"$UI_STACK ($UI_STATUS, score $UI_SCORE)\"",
    "  print_kv \"Detected backend\" \"$BACKEND_STACK ($BACKEND_STATUS, score $BACKEND_SCORE)\"",
    "  print_kv \"Detected database\" \"$DB_STACK ($DB_STATUS, score $DB_SCORE)\"",
    "  [ -n \"$NEEDS_USER_DECISION\" ] && print_kv \"Needs decision\" \"$NEEDS_USER_DECISION\"",
    "  echo \"\"",
    "  if [ \"${#STEPS[@]}\" -eq 0 ]; then",
    "    echo \"  No scaffold/config steps selected.\"",
    "  else",
    "    local raw id stack target",
    "    for raw in \"${STEPS[@]}\"; do",
    "      IFS=':' read -r id stack target <<< \"$raw\"",
    "      printf '  %s->%s [%s] %s -> %s\\n' \"$C_CYAN\" \"$C_RESET\" \"$id\" \"$stack\" \"$target\"",
    "      printf '     %s%s%s\\n' \"$C_DIM\" \"$(step_command \"$id\" \"$stack\" \"$target\")\" \"$C_RESET\"",
    "    done",
    "  fi",
    "  echo \"\"",
    "  if [ \"$DRY_RUN\" = \"1\" ]; then",
    "    info \"Dry run requested. No changes will be made.\"",
    "    return 1",
    "  fi",
    "  if [ \"$YES\" = \"1\" ]; then",
    "    return 0",
    "  fi",
    "  printf \"Proceed with these actions? [y/N]: \"",
    "  read -r confirm",
    "  case \"$confirm\" in",
    "    y|Y|yes|YES) return 0 ;;",
    "    *) warn \"User cancelled execution after preview.\"; return 1 ;;",
    "  esac",
    "}",
    "",
    "mark_step_state() {",
    "  local id=\"$1\"",
    "  local state=\"$2\"",
    "  STEP_RESULTS=\"$STEP_RESULTS $id=$state\"",
    "  debug \"step $id => $state\"",
    "}",
    "",
    "run_with_retry() {",
    "  local command_text=\"$1\"",
    "  local output_log=\"$2\"",
    "  local retry_cleanup_path=\"${3:-}\"",
    "  local attempts=0",
    "  local max_attempts=2",
    "  local command_status=0",
    "  while [ \"$attempts\" -lt \"$max_attempts\" ]; do",
    "    attempts=$((attempts + 1))",
    "    if [ \"$attempts\" -gt 1 ] && [ -n \"$retry_cleanup_path\" ] && [ -e \"$retry_cleanup_path\" ]; then",
    "      rm -rf \"$retry_cleanup_path\"",
    "    fi",
    "    debug \"attempt $attempts: $command_text\"",
    "    printf '\\n--- attempt %s: %s ---\\n' \"$attempts\" \"$command_text\" >> \"$output_log\"",
    "    if command_exists timeout; then",
    "      timeout 900 bash -lc \"$command_text\" >> \"$output_log\" 2>&1",
    "      command_status=$?",
    "    else",
    "      bash -lc \"$command_text\" >> \"$output_log\" 2>&1",
    "      command_status=$?",
    "    fi",
    "    if [ \"$command_status\" -eq 0 ]; then",
    "      cat \"$output_log\" >> \"$LOG_FILE\"",
    "      return 0",
    "    fi",
    "    cat \"$output_log\" >> \"$LOG_FILE\"",
    "    warn \"Command failed (attempt $attempts/$max_attempts): $command_text\"",
    "    warn \"See detailed output: $output_log\"",
    "  done",
    "  return 1",
    "}",
    "",
    "execute_scaffold_step() {",
    "  local id=\"$1\"",
    "  local stack=\"$2\"",
    "  local target=\"$3\"",
    "  local command_text",
    "  local step_log",
    "  local run_dir=\"$REPO_ROOT\"",
    "  local run_target=\"$target\"",
    "  local temp_parent=\"\"",
    "  local target_abs=\"$REPO_ROOT/$target\"",
    "  local target_parent",
    "  local target_name",
    "",
    "  if [ \"$target\" != \".\" ]; then",
    "    target_parent=\"$(dirname \"$target_abs\")\"",
    "    target_name=\"$(basename \"$target\")\"",
    "    temp_parent=\"$TMP_DIR/scaffold-$RUN_ID-$id-$stack\"",
    "    run_dir=\"$temp_parent\"",
    "    run_target=\"$target_name\"",
    "  fi",
    "",
    "  command_text=\"$(step_command \"$id\" \"$stack\" \"$run_target\")\"",
    "  step_log=\"$LOG_DIR/$RUN_ID-$id-$stack.log\"",
    "",
    "  if ! validate_required_tools \"$id\" \"$stack\"; then",
    "    mark_step_state \"$id:$stack\" \"skipped_missing_tools\"",
    "    return 0",
    "  fi",
    "",
    "  if [ -e \"$target_abs\" ] && [ \"$target\" != \".\" ] && [ \"$FORCE\" != \"1\" ]; then",
    "    warn \"Target $target already exists. Skipping to avoid overwriting user files.\"",
    "    mark_step_state \"$id:$stack\" \"skipped_existing_target\"",
    "    return 0",
    "  fi",
    "",
    "  progress \"Executing $id/$stack\"",
    "  info \"Scaffolding happens in specs/.devx/tmp first, then moves into $target after success.\"",
    "  info \"This can take a minute if packages need to download.\"",
    "  mark_step_state \"$id:$stack\" \"started\"",
    "  if [ -n \"$temp_parent\" ]; then",
    "    rm -rf \"$temp_parent\"",
    "    mkdir -p \"$temp_parent\"",
    "  fi",
    "",
    "  if (cd \"$run_dir\" && run_with_retry \"$command_text\" \"$step_log\" \"${temp_parent:+$temp_parent/$run_target}\"); then",
    "    if [ -n \"$temp_parent\" ]; then",
    "      if [ ! -d \"$temp_parent/$run_target\" ]; then",
    "        warn \"Scaffold command succeeded, but expected output folder was not created: $temp_parent/$run_target\"",
    "        mark_step_state \"$id:$stack\" \"failed_missing_output\"",
    "        return 1",
    "      fi",
    "      mkdir -p \"$target_parent\"",
    "      if [ -e \"$target_abs\" ]; then",
    "        backup_path=\"$TMP_DIR/backup-$RUN_ID-$id-$stack-$target_name\"",
    "        warn \"Backing up existing $target to $backup_path before applying --force output\"",
    "        mv \"$target_abs\" \"$backup_path\"",
    "      fi",
    "      mv \"$temp_parent/$run_target\" \"$target_abs\"",
    "      rm -rf \"$temp_parent\"",
    "    fi",
    "    mark_step_state \"$id:$stack\" \"succeeded\"",
    "    success \"$id/$stack completed\"",
    "  else",
    "    local failed_dir=\"$TMP_DIR/failed-$RUN_ID-$id-$stack\"",
    "    mkdir -p \"$failed_dir\"",
    "    if [ -n \"$temp_parent\" ] && [ -d \"$temp_parent\" ]; then",
    "      mv \"$temp_parent\" \"$failed_dir/scaffold-output\"",
    "    fi",
    "    warn \"Step failed. Recovery notes preserved at $failed_dir/README.txt\"",
    "    printf 'Failed step: %s/%s\\nCommand: %s\\nOutput log: %s\\nPartial scaffold output: %s/scaffold-output\\nRetry after fixing prerequisites.\\n' \"$id\" \"$stack\" \"$command_text\" \"$step_log\" \"$failed_dir\" > \"$failed_dir/README.txt\"",
    "    mark_step_state \"$id:$stack\" \"failed\"",
    "    return 1",
    "  fi",
    "}",
    "",
    "upsert_marked_block() {",
    "  local file=\"$1\"",
    "  local section=\"$2\"",
    "  local body=\"$3\"",
    "  local start=\"<!-- DEVX:$section:START -->\"",
    "  local end=\"<!-- DEVX:$section:END -->\"",
    "  local dir",
    "  dir=\"$(dirname \"$file\")\"",
    "  mkdir -p \"$dir\"",
    "  local tmp",
    "  tmp=\"$(mktemp)\"",
    "  if [ -f \"$file\" ]; then",
    "    awk -v start=\"$start\" -v end=\"$end\" '",
    "      $0 == start { skip=1; next }",
    "      $0 == end { skip=0; next }",
    "      skip != 1 { print }",
    "    ' \"$file\" > \"$tmp\"",
    "  fi",
    "  {",
    "    cat \"$tmp\" 2>/dev/null || true",
    "    printf '\\n%s\\n%s\\n%s\\n' \"$start\" \"$body\" \"$end\"",
    "  } > \"$file\"",
    "  rm -f \"$tmp\"",
    "}",
    "",
    "configure_database() {",
    "  local db=\"$1\"",
    "  local env_file=\"$REPO_ROOT/.env.example\"",
    "  local url",
    "  case \"$db\" in",
    "    mysql) url=\"DATABASE_URL=mysql://user:password@localhost:3306/app_db\" ;;",
    "    sqlserver) url=\"DATABASE_URL=sqlserver://user:password@localhost:1433;database=app_db\" ;;",
    "    postgres) url=\"DATABASE_URL=postgresql://user:password@localhost:5432/app_db\" ;;",
    "    mongodb) url=\"DATABASE_URL=mongodb://localhost:27017/app_db\" ;;",
    "    oracle) url=\"DATABASE_URL=oracle://user:password@localhost:1521/app_db\" ;;",
    "    *) url=\"# DATABASE_URL=\" ;;",
    "  esac",
    "  upsert_marked_block \"$env_file\" \"ENVIRONMENT\" \"# DevX example only. Do not store real secrets here.",
    "$url\"",
    "  mark_step_state \"database:$db\" \"succeeded\"",
    "}",
    "",
    "write_workspace_context() {",
    "  info \"Updating workspace context\"",
    "  local metadata",
    "  metadata=\"{",
    "  \\\"schemaVersion\\\": 1,",
    "  \\\"runId\\\": \\\"$(json_escape \"$RUN_ID\")\\\",",
    "  \\\"workspaceMode\\\": \\\"$(json_escape \"$MONOREPO_MODE\")\\\",",
    "  \\\"packageManager\\\": \\\"$(json_escape \"$PACKAGE_MANAGER\")\\\",",
    "  \\\"selectedAiTool\\\": \\\"$(json_escape \"$SELECTED_TOOL\")\\\",",
    "  \\\"ui\\\": { \\\"detected\\\": \\\"$(json_escape \"$UI_STACK\")\\\", \\\"status\\\": \\\"$(json_escape \"$UI_STATUS\")\\\", \\\"score\\\": $UI_SCORE, \\\"selected\\\": \\\"$(json_escape \"$SELECT_UI\")\\\", \\\"reactPostCreate\\\": \\\"$(json_escape \"$REACT_POST_CREATE\")\\\" },",
    "  \\\"backend\\\": { \\\"detected\\\": \\\"$(json_escape \"$BACKEND_STACK\")\\\", \\\"status\\\": \\\"$(json_escape \"$BACKEND_STATUS\")\\\", \\\"score\\\": $BACKEND_SCORE, \\\"selected\\\": \\\"$(json_escape \"$SELECT_BACKEND\")\\\" },",
    "  \\\"database\\\": { \\\"detected\\\": \\\"$(json_escape \"$DB_STACK\")\\\", \\\"status\\\": \\\"$(json_escape \"$DB_STATUS\")\\\", \\\"score\\\": $DB_SCORE, \\\"selected\\\": \\\"$(json_escape \"$SELECT_DB\")\\\" }",
    "}\"",
    "  cat > \"$WORKSPACE_CONTEXT_FILE\" <<CONTEXT",
    "# Workspace Context",
    "",
    "<!-- DEVX:WORKSPACE-CONTEXT:START -->",
    "Generated by specs/.devx/init.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).",
    "",
    "## Workspace Summary",
    "",
    "- Mode: $MONOREPO_MODE",
    "- Package manager: $PACKAGE_MANAGER",
    "- AI tool: $(tool_label \"$SELECTED_TOOL\")",
    "- Nested repositories/submodules: ${NESTED_REPOS:-none}",
    "- CI/CD markers: ${CI_MARKERS:-none}",
    "- Environment markers: ${ENV_MARKERS:-none}",
    "",
    "## Detected Architecture",
    "",
    "- UI: $UI_STACK ($UI_STATUS, score $UI_SCORE)",
    "- Backend: $BACKEND_STACK ($BACKEND_STATUS, score $BACKEND_SCORE)",
    "- Database: $DB_STACK ($DB_STATUS, score $DB_SCORE)",
    "",
    "## Selected Setup",
    "",
    "- UI scaffold: $SELECT_UI -> $UI_TARGET",
    "- React post-create action: $REACT_POST_CREATE",
    "- Backend scaffold: $SELECT_BACKEND -> $BACKEND_TARGET",
    "- Database guidance: $SELECT_DB",
    "",
    "## Commands",
    "",
    "- Install dependencies: $(pm_install)",
    "- Run JS scripts: $(pm_run) <script>",
    "- Workspace discovery: bash specs/.devx/discover-workspace.sh",
    "",
    "## Environment And Secrets",
    "",
    "Use .env.example for placeholders only. Never commit real secrets.",
    "",
    "## Constraints",
    "",
    "DevX-managed sections use DEVX markers. User-authored content outside those markers should be preserved.",
    "",
    "## Generated Metadata JSON",
    "",
    "$metadata",
    "<!-- DEVX:WORKSPACE-CONTEXT:END -->",
    "CONTEXT",
    "}",
    "",
    "write_config() {",
    "  local run_status=\"${1:-completed}\"",
    "  cat > \"$CONFIG_FILE\" <<CONFIG",
    "{",
    "  \"schemaVersion\": 1,",
    "  \"runId\": \"$(json_escape \"$RUN_ID\")\",",
    "  \"status\": \"$(json_escape \"$run_status\")\",",
    "  \"lastRunAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",",
    "  \"workspaceMode\": \"$(json_escape \"${MONOREPO_MODE:-unknown}\")\",",
    "  \"packageManager\": \"$(json_escape \"${PACKAGE_MANAGER:-unknown}\")\",",
    "  \"selectedAiTool\": \"$(json_escape \"$SELECTED_TOOL\")\",",
    "  \"only\": \"$(json_escape \"$ONLY\")\",",
    "  \"dryRun\": $DRY_RUN,",
    "  \"force\": $FORCE,",
    "  \"skipValidation\": $SKIP_VALIDATION,",
    "  \"detected\": {",
    "    \"ui\": { \"stack\": \"$(json_escape \"${UI_STACK:-none}\")\", \"score\": ${UI_SCORE:-0}, \"status\": \"$(json_escape \"${UI_STATUS:-unknown}\")\" },",
    "    \"backend\": { \"stack\": \"$(json_escape \"${BACKEND_STACK:-none}\")\", \"score\": ${BACKEND_SCORE:-0}, \"status\": \"$(json_escape \"${BACKEND_STATUS:-unknown}\")\" },",
    "    \"database\": { \"stack\": \"$(json_escape \"${DB_STACK:-none}\")\", \"score\": ${DB_SCORE:-0}, \"status\": \"$(json_escape \"${DB_STATUS:-unknown}\")\" }",
    "  },",
    "  \"selected\": {",
    "    \"ui\": \"$(json_escape \"${SELECT_UI:-none}\")\",",
    "    \"backend\": \"$(json_escape \"${SELECT_BACKEND:-none}\")\",",
    "    \"database\": \"$(json_escape \"${SELECT_DB:-none}\")\",",
    "    \"reactPostCreate\": \"$(json_escape \"${REACT_POST_CREATE:-ask}\")\"",
    "  },",
    "  \"targets\": {",
    "    \"ui\": \"$(json_escape \"${UI_TARGET:-}\")\",",
    "    \"backend\": \"$(json_escape \"${BACKEND_TARGET:-}\")\"",
    "  },",
    "  \"toolVersions\": {",
    "    \"node\": \"$(json_escape \"$(safe_version node)\")\",",
    "    \"npm\": \"$(json_escape \"$(safe_version npm)\")\",",
    "    \"pnpm\": \"$(json_escape \"$(safe_version pnpm)\")\",",
    "    \"yarn\": \"$(json_escape \"$(safe_version yarn)\")\",",
    "    \"python3\": \"$(json_escape \"$(safe_version python3)\")\",",
    "    \"go\": \"$(json_escape \"$(safe_version go)\")\",",
    "    \"dotnet\": \"$(json_escape \"$(safe_version dotnet)\")\",",
    "    \"php\": \"$(json_escape \"$(safe_version php)\")\",",
    "    \"composer\": \"$(json_escape \"$(safe_version composer)\")\",",
    "    \"ruby\": \"$(json_escape \"$(safe_version ruby)\")\",",
    "    \"rails\": \"$(json_escape \"$(safe_version rails)\")\"",
    "  },",
    "  \"markers\": {",
    "    \"nestedRepos\": \"$(json_escape \"${NESTED_REPOS:-}\")\",",
    "    \"ci\": \"$(json_escape \"${CI_MARKERS:-}\")\",",
    "    \"environment\": \"$(json_escape \"${ENV_MARKERS:-}\")\"",
    "  },",
    "  \"stepResults\": \"$(json_escape \"${STEP_RESULTS:-}\")\",",
    "  \"needsUserDecision\": \"$(json_escape \"${NEEDS_USER_DECISION:-}\")\",",
    "  \"logFile\": \"$(json_escape \"$LOG_FILE\")\"",
    "}",
    "CONFIG",
    "}",
    "",
    "# Build the universal context from project.md + workflow.md",
    "PROJECT_CONTEXT=\"\"",
    "WORKFLOW_CONTEXT=\"\"",
    "if [ -f \"$DEVX_DIR/project.md\" ]; then PROJECT_CONTEXT=$(cat \"$DEVX_DIR/project.md\"); else warn \"Missing $DEVX_DIR/project.md; using empty project context\"; fi",
    "if [ -f \"$DEVX_DIR/workflow.md\" ]; then WORKFLOW_CONTEXT=$(cat \"$DEVX_DIR/workflow.md\"); else warn \"Missing $DEVX_DIR/workflow.md; using empty workflow context\"; fi",
    "CENTRAL_CONTEXT_REFERENCE=\"This repository uses Astra Spec-Driven Development. Read specs/.devx/workspace-context.md first, then follow specs/.devx/features.json and each specs/<feature-slug>/ folder.\"",
    "",
    "COMBINED_CONTEXT=\"$PROJECT_CONTEXT",
    "",
    "---",
    "",
    "$WORKFLOW_CONTEXT\"",
    "",
    "write_context_file() {",
    "  local target_file=\"$1\"",
    "  local display_name=\"$2\"",
    "  upsert_marked_block \"$target_file\" \"AI-CONTEXT\" \"$CENTRAL_CONTEXT_REFERENCE\"",
    "  info \"Updated $display_name\"",
    "}",
    "",
    "install_mcp_dependencies() {",
    "  local mcp_dir=\"$DEVX_DIR/mcp\"",
    "  echo \"\"",
    "  info \"Setting up MCP server dependencies\"",
    "  if [ -d \"$mcp_dir\" ] && [ -f \"$mcp_dir/package.json\" ]; then",
    "    if [ \"$DRY_RUN\" = \"1\" ]; then",
    "      info \"Dry-run: would install MCP dependencies\"",
    "    elif command_exists npm; then",
    "      (cd \"$mcp_dir\" && npm install --silent 2>/dev/null) || warn \"MCP dependency install failed; retry manually in $mcp_dir\"",
    "      info \"MCP server dependencies installed\"",
    "    else",
    "      warn \"npm is missing; skipping MCP dependency install\"",
    "    fi",
    "  else",
    "    warn \"MCP server not found at $mcp_dir; skipping\"",
    "  fi",
    "}",
    "",
    "write_mcp_config() {",
    "  local target_file=\"$1\"",
    "  local display_name=\"$2\"",
    "  local json_body=\"$3\"",
    "  local target_dir",
    "  target_dir=\"$(dirname \"$target_file\")\"",
    "  mkdir -p \"$target_dir\"",
    "  if [ \"$DRY_RUN\" = \"1\" ]; then",
    "    info \"Dry-run: would write $display_name MCP config\"",
    "  elif [ ! -f \"$target_file\" ]; then",
    "    printf '%s\\n' \"$json_body\" > \"$target_file\"",
    "    info \"Created $display_name with MCP config\"",
    "  else",
    "    warn \"$display_name already exists; add MCP config manually if needed\"",
    "  fi",
    "}",
    "",
    "setup_claude() {",
    "  write_context_file \"$REPO_ROOT/CLAUDE.md\" \"CLAUDE.md\"",
    "  install_mcp_dependencies",
    "",
    "  MCP_SERVER_PATH=\"specs/.devx/mcp/server.js\"",
    "  write_mcp_config \"$REPO_ROOT/.claude/settings.json\" \".claude/settings.json\" \"{",
    "  \\\"mcpServers\\\": {",
    "    \\\"devx-specs\\\": {",
    "      \\\"command\\\": \\\"node\\\",",
    "      \\\"args\\\": [\\\"$MCP_SERVER_PATH\\\"],",
    "      \\\"cwd\\\": \\\".\\\"",
    "    }",
    "  }",
    "}\"",
    "",
    "  info \"Setting up Claude Code skills\"",
    "  SKILLS_SRC=\"$DEVX_DIR/skills\"",
    "  SKILLS_DST=\"$REPO_ROOT/.claude/skills\"",
    "  if [ \"$DRY_RUN\" = \"1\" ]; then",
    "    info \"Dry-run: would copy Claude skills to .claude/skills\"",
    "  elif [ -d \"$SKILLS_SRC\" ]; then",
    "    mkdir -p \"$SKILLS_DST\"",
    "    for skill_dir in \"$SKILLS_SRC\"/*/; do",
    "      if [ -d \"$skill_dir\" ]; then",
    "        skill_name=$(basename \"$skill_dir\")",
    "        mkdir -p \"$SKILLS_DST/$skill_name\"",
    "        cp \"$skill_dir/SKILL.md\" \"$SKILLS_DST/$skill_name/\" 2>/dev/null || true",
    "      fi",
    "    done",
    "    info \"Copied skills to .claude/skills\"",
    "  else",
    "    warn \"Skills directory not found at $SKILLS_SRC; skipping\"",
    "  fi",
    "}",
    "",
    "setup_codex_wrappers() {",
    "  local codex_dir=\"$DEVX_DIR/codex\"",
    "  if [ \"$DRY_RUN\" = \"1\" ]; then",
    "    info \"Dry-run: would create Codex automation helpers in specs/.devx/codex\"",
    "    return",
    "  fi",
    "",
    "  mkdir -p \"$codex_dir\"",
    "  cat > \"$codex_dir/implement-next.sh\" <<'CODEX_EOF'",
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
    "DEVX_DIR=\"$(cd \"$SCRIPT_DIR/..\" && pwd)\"",
    "PROMPT=\"$(bash \"$DEVX_DIR/devx-command.sh\" implement-next)\"",
    "if command -v codex >/dev/null 2>&1; then",
    "  codex \"$PROMPT\" || {",
    "    printf '%s\\n\\n' \"Codex CLI could not start interactively. Use this prompt manually:\"",
    "    printf '%s\\n' \"$PROMPT\"",
    "  }",
    "else",
    "  printf '%s\\n\\n' \"Codex CLI was not found. Use this prompt manually:\"",
    "  printf '%s\\n' \"$PROMPT\"",
    "fi",
    "CODEX_EOF",
    "",
    "  cat > \"$codex_dir/implement-feature.sh\" <<'CODEX_EOF'",
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "if [ -z \"${1:-}\" ]; then",
    "  echo \"Usage: bash specs/.devx/codex/implement-feature.sh <feature-slug>\" >&2",
    "  exit 1",
    "fi",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
    "DEVX_DIR=\"$(cd \"$SCRIPT_DIR/..\" && pwd)\"",
    "PROMPT=\"$(bash \"$DEVX_DIR/devx-command.sh\" implement-feature \"$1\")\"",
    "if command -v codex >/dev/null 2>&1; then",
    "  codex \"$PROMPT\" || {",
    "    printf '%s\\n\\n' \"Codex CLI could not start interactively. Use this prompt manually:\"",
    "    printf '%s\\n' \"$PROMPT\"",
    "  }",
    "else",
    "  printf '%s\\n\\n' \"Codex CLI was not found. Use this prompt manually:\"",
    "  printf '%s\\n' \"$PROMPT\"",
    "fi",
    "CODEX_EOF",
    "",
    "  cat > \"$codex_dir/validate-feature.sh\" <<'CODEX_EOF'",
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "if [ -z \"${1:-}\" ]; then",
    "  echo \"Usage: bash specs/.devx/codex/validate-feature.sh <feature-slug>\" >&2",
    "  exit 1",
    "fi",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
    "DEVX_DIR=\"$(cd \"$SCRIPT_DIR/..\" && pwd)\"",
    "PROMPT=\"$(bash \"$DEVX_DIR/devx-command.sh\" validate-feature \"$1\")\"",
    "if command -v codex >/dev/null 2>&1; then",
    "  codex \"$PROMPT\" || {",
    "    printf '%s\\n\\n' \"Codex CLI could not start interactively. Use this prompt manually:\"",
    "    printf '%s\\n' \"$PROMPT\"",
    "  }",
    "else",
    "  printf '%s\\n\\n' \"Codex CLI was not found. Use this prompt manually:\"",
    "  printf '%s\\n' \"$PROMPT\"",
    "fi",
    "CODEX_EOF",
    "",
    "  chmod +x \"$codex_dir\"/*.sh 2>/dev/null || true",
    "  info \"Created Codex automation helpers in specs/.devx/codex\"",
    "  echo \"\"",
    "  echo \"Codex automation:\"",
    "  echo \"  bash specs/.devx/codex/implement-next.sh\"",
    "  echo \"  bash specs/.devx/codex/implement-feature.sh <feature-slug>\"",
    "  echo \"  bash specs/.devx/codex/validate-feature.sh <feature-slug>\"",
    "}",
    "",
    "setup_codex() {",
    "  write_context_file \"$REPO_ROOT/AGENTS.md\" \"AGENTS.md\"",
    "  setup_codex_wrappers",
    "}",
    "",
    "setup_cursor() {",
    "  write_context_file \"$REPO_ROOT/.cursorrules\" \".cursorrules\"",
    "  install_mcp_dependencies",
    "",
    "  MCP_SERVER_PATH=\"specs/.devx/mcp/server.js\"",
    "  write_mcp_config \"$REPO_ROOT/.cursor/mcp.json\" \".cursor/mcp.json\" \"{",
    "  \\\"mcpServers\\\": {",
    "    \\\"devx-specs\\\": {",
    "      \\\"command\\\": \\\"node\\\",",
    "      \\\"args\\\": [\\\"$MCP_SERVER_PATH\\\"]",
    "    }",
    "  }",
    "}\"",
    "}",
    "",
    "setup_copilot() {",
    "  write_context_file \"$REPO_ROOT/.github/copilot-instructions.md\" \".github/copilot-instructions.md\"",
    "}",
    "",
    "setup_windsurf() {",
    "  write_context_file \"$REPO_ROOT/.windsurfrules\" \".windsurfrules\"",
    "}",
    "",
    "setup_cline() {",
    "  write_context_file \"$REPO_ROOT/.clinerules\" \".clinerules\"",
    "}",
    "",
    "setup_kiro() {",
    "  KIRO_DIR=\"$REPO_ROOT/.kiro/steering\"",
    "  mkdir -p \"$KIRO_DIR\"",
    "  KIRO_FILE=\"$KIRO_DIR/devx-context.md\"",
    "  write_context_file \"$KIRO_FILE\" \".kiro/steering/devx-context.md\"",
    "",
    "  install_mcp_dependencies",
    "",
    "  MCP_SERVER_PATH=\"specs/.devx/mcp/server.js\"",
    "  write_mcp_config \"$REPO_ROOT/.kiro/settings/mcp.json\" \".kiro/settings/mcp.json\" \"{",
    "  \\\"mcpServers\\\": {",
    "    \\\"devx-specs\\\": {",
    "      \\\"command\\\": \\\"node\\\",",
    "      \\\"args\\\": [\\\"$MCP_SERVER_PATH\\\"]",
    "    }",
    "  }",
    "}\"",
    "}",
    "",
    "configure_ai() {",
    "  local tool=\"$1\"",
    "  case \"$tool\" in",
    "    claude) setup_claude ;;",
    "    codex) setup_codex ;;",
    "    cursor) setup_cursor ;;",
    "    copilot) setup_copilot ;;",
    "    windsurf) setup_windsurf ;;",
    "    cline) setup_cline ;;",
    "    kiro) setup_kiro ;;",
    "  esac",
    "  mark_step_state \"ai:$tool\" \"succeeded\"",
    "}",
    "",
    "run_workspace_discovery() {",
    "  DISCOVERY_SCRIPT=\"$DEVX_DIR/discover-workspace.sh\"",
    "  if [[ \"$OSTYPE\" == msys* || \"$OSTYPE\" == cygwin* ]]; then",
    "    warn \"Skipping automatic discovery in Windows shell due known fork instability. Run from WSL with: bash specs/.devx/discover-workspace.sh\"",
    "    mark_step_state \"discovery\" \"skipped_windows_shell\"",
    "    return",
    "  fi",
    "  if [ -f \"$DISCOVERY_SCRIPT\" ]; then",
    "    progress \"Running workspace discovery\"",
    "    if [ \"$DRY_RUN\" = \"1\" ]; then",
    "      info \"Dry-run: would run $DISCOVERY_SCRIPT\"",
    "      mark_step_state \"discovery\" \"dry_run\"",
    "      return",
    "    elif bash \"$DISCOVERY_SCRIPT\"; then",
    "      success \"Workspace discovery completed\"",
    "      mark_step_state \"discovery\" \"succeeded\"",
    "    else",
    "      warn \"Workspace discovery failed; retry with: bash specs/.devx/discover-workspace.sh\"",
    "      mark_step_state \"discovery\" \"failed\"",
    "    fi",
    "  else",
    "    warn \"Workspace discovery script not found: $DISCOVERY_SCRIPT\"",
    "    mark_step_state \"discovery\" \"missing_script\"",
    "  fi",
    "}",
    "",
    "execute_steps() {",
    "  phase \"[4/6] Execute selected steps\"",
    "  local raw id stack target",
    "  local total index",
    "  total=\"${#STEPS[@]}\"",
    "  index=0",
    "  for raw in \"${STEPS[@]}\"; do",
    "    index=$((index + 1))",
    "    IFS=':' read -r id stack target <<< \"$raw\"",
    "    progress \"Step $index/$total: $id/$stack\"",
    "    case \"$id\" in",
    "      scaffold-ui|scaffold-backend) execute_scaffold_step \"$id\" \"$stack\" \"$target\" || true ;;",
    "      configure-database) configure_database \"$stack\" ;;",
    "      workspace-discovery) run_workspace_discovery ;;",
    "      configure-ai)",
    "        write_workspace_context",
    "        configure_ai \"$stack\"",
    "        ;;",
    "    esac",
    "  done",
    "}",
    "",
    "validate_workspace() {",
    "  if [ \"$SKIP_VALIDATION\" = \"1\" ] || [ \"$DRY_RUN\" = \"1\" ]; then",
    "    info \"Validation skipped\"",
    "    return",
    "  fi",
    "  if [[ \"$OSTYPE\" == msys* || \"$OSTYPE\" == cygwin* ]]; then",
    "    warn \"Skipping validation in Windows shell due known fork instability. Run validation from WSL/Linux/macOS.\"",
    "    mark_step_state \"validation\" \"skipped_windows_shell\"",
    "    return",
    "  fi",
    "  phase \"[5/6] Validate workspace\"",
    "  local run_cmd",
    "  run_cmd=\"$(pm_run)\"",
    "  if [ -f \"$REPO_ROOT/package.json\" ] && command_exists node; then",
    "    if grep -q '\"build\"' \"$REPO_ROOT/package.json\"; then",
    "      (cd \"$REPO_ROOT\" && $run_cmd build) || warn \"Root build validation failed\"",
    "    fi",
    "    if grep -q '\"test\"' \"$REPO_ROOT/package.json\"; then",
    "      info \"Test script detected. Skipping automatic tests by default; run them manually when ready.\"",
    "    fi",
    "  fi",
    "}",
    "",
    "detect_workspace",
    "select_missing_layers",
    "register_steps",
    "if preview_plan; then",
    "  execute_steps",
    "  validate_workspace",
    "  write_workspace_context",
    "  write_config \"completed\"",
    "else",
    "  if [ \"$DRY_RUN\" = \"0\" ]; then",
    "    write_workspace_context",
    "    write_config \"planned\"",
    "  fi",
    "fi",
    "",
    "phase \"[6/6] Summary\"",
    "if [ \"$DRY_RUN\" = \"1\" ]; then",
    "  success \"Dry run complete. No workspace files were changed.\"",
    "else",
    "  success \"Done. DevX init status is recorded in specs/.devx/config.json\"",
    "fi",
    "printf '\\n%sNext steps%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "printf '  %s1.%s Review specs/.devx/workspace-context.md\\n' \"$C_CYAN\" \"$C_RESET\"",
    "printf '  %s2.%s Review specs/.devx/workspace-repos.json and feature-routing.json\\n' \"$C_CYAN\" \"$C_RESET\"",
    "printf '  %s3.%s Use your AI tool with the generated central context\\n' \"$C_CYAN\" \"$C_RESET\"",
    "printf '  %s4.%s If setup was skipped, fix config.json decisions and rerun\\n' \"$C_CYAN\" \"$C_RESET\"",
    "printf '\\n%sLog file%s %s\\n' \"$C_DIM\" \"$C_RESET\" \"$LOG_FILE\"",
    "echo \"\"",
    "case \"$SELECTED_TOOL\" in",
    "  claude)",
    "    printf '%sClaude Code:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  CLAUDE.md references specs/.devx/workspace-context.md. MCP and skills are configured where possible.\"",
    "    ;;",
    "  codex)",
    "    printf '%sCodex:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  AGENTS.md references specs/.devx/workspace-context.md.\"",
    "    ;;",
    "  cursor)",
    "    printf '%sCursor:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  .cursorrules references specs/.devx/workspace-context.md and MCP is configured where possible.\"",
    "    ;;",
    "  copilot)",
    "    printf '%sGitHub Copilot:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  .github/copilot-instructions.md references specs/.devx/workspace-context.md.\"",
    "    ;;",
    "  windsurf)",
    "    printf '%sWindsurf:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  .windsurfrules references specs/.devx/workspace-context.md.\"",
    "    ;;",
    "  cline)",
    "    printf '%sCline:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  .clinerules references specs/.devx/workspace-context.md.\"",
    "    ;;",
    "  kiro)",
    "    printf '%sKiro:%s\\n' \"$C_BOLD\" \"$C_RESET\"",
    "    echo \"  Steering context references specs/.devx/workspace-context.md and MCP is configured where possible.\"",
    "    ;;",
    "esac",
    ""
  ].join("\n");
}

//  MCP Server Generators 

function generateMcpServerJs(): string {
  return `#!/usr/bin/env node
/**
 * Astra MCP Server  -  Exposes project specs to AI tools via the Model Context Protocol.
 *
 * This is a self-contained stdio MCP server. Run it with:
 *   node server.js
 *
 * It reads from the specs/ folder relative to the repo root and exposes
 * tools for listing features, reading specs, managing status, etc.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta${'.'}url);
const __dirname = dirname(__filename);

// Resolve paths relative to repo root (specs/.devx/mcp/ -> repo root)
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SPECS_DIR = resolve(REPO_ROOT, "specs");
const DEVX_DIR = resolve(SPECS_DIR, ".devx");
const FEATURES_JSON = resolve(DEVX_DIR, "features.json");
const TRACKER_JSON = resolve(DEVX_DIR, "tracker.json");

//  Helpers 

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readText(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

function getFeaturesData() {
  const data = readJson(FEATURES_JSON);
  if (!data || !data.features) {
    throw new Error("features.json not found or invalid. Run specs generation first.");
  }
  return data;
}

function getTrackerData() {
  const data = readJson(TRACKER_JSON);
  if (data && data.tasks) return data;
  return { trackerVersion: 1, updatedAt: new Date().toISOString(), tasks: {} };
}

function findFeature(query) {
  const data = getFeaturesData();
  const q = query.toLowerCase().trim();
  return data.features.find(
    (f) =>
      f.slug === q ||
      f.title.toLowerCase() === q ||
      f.slug === q.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      f.id.toString() === q
  );
}

//  Server Setup 

const server = new Server(
  { name: "devx-specs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

//  Tool Definitions 

const TOOLS = [
  {
    name: "list_features",
    description: "List all features with their status, slug, and story count from features.json.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_feature_specs",
    description: "Get the full specs.md content for a feature by slug, title, or ID.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature slug, title, or ID" },
      },
      required: ["feature"],
    },
  },
  {
    name: "get_requirements",
    description: "Get the requirements.md checklist for a feature.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature slug, title, or ID" },
      },
      required: ["feature"],
    },
  },
  {
    name: "get_tdd_tests",
    description: "Get the tdd-tests.md content for a feature (if TDD is enabled).",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature slug, title, or ID" },
      },
      required: ["feature"],
    },
  },
  {
    name: "get_next_feature",
    description: "Suggest the next feature to implement (first one with status 'not-started').",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "validate_implementation",
    description: "Return the requirements checklist for a feature so you can validate your implementation against it.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature slug, title, or ID" },
      },
      required: ["feature"],
    },
  },
  {
    name: "mark_feature_done",
    description: "Update a feature's status in features.json to 'done'.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature slug, title, or ID" },
      },
      required: ["feature"],
    },
  },
  {
    name: "get_project_context",
    description: "Return the full project.md and workflow.md content for project-level context.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

//  Tool Handlers 

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_features": {
        const data = getFeaturesData();
        const summary = data.features.map((f) => ({
          id: f.id,
          title: f.title,
          slug: f.slug,
          status: f.status,
          storyCount: f.storyCount,
          totalStoryPoints: f.totalStoryPoints,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { totalFeatures: data.totalFeatures, enableTdd: data.enableTdd, features: summary },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_feature_specs": {
        const feature = findFeature(args.feature);
        if (!feature) {
          return { content: [{ type: "text", text: \`Feature not found: \${args.feature}\` }], isError: true };
        }
        const specsPath = resolve(REPO_ROOT, feature.files.specs);
        const content = readText(specsPath);
        if (!content) {
          return { content: [{ type: "text", text: \`specs.md not found at \${feature.files.specs}\` }], isError: true };
        }
        return { content: [{ type: "text", text: content }] };
      }

      case "get_requirements": {
        const feature = findFeature(args.feature);
        if (!feature) {
          return { content: [{ type: "text", text: \`Feature not found: \${args.feature}\` }], isError: true };
        }
        const reqPath = resolve(REPO_ROOT, feature.files.requirements);
        const content = readText(reqPath);
        if (!content) {
          return { content: [{ type: "text", text: \`requirements.md not found at \${feature.files.requirements}\` }], isError: true };
        }
        return { content: [{ type: "text", text: content }] };
      }

      case "get_tdd_tests": {
        const feature = findFeature(args.feature);
        if (!feature) {
          return { content: [{ type: "text", text: \`Feature not found: \${args.feature}\` }], isError: true };
        }
        if (!feature.files.tddTests) {
          return { content: [{ type: "text", text: \`TDD is not enabled for feature: \${feature.title}\` }], isError: true };
        }
        const tddPath = resolve(REPO_ROOT, feature.files.tddTests);
        const content = readText(tddPath);
        if (!content) {
          return { content: [{ type: "text", text: \`tdd-tests.md not found at \${feature.files.tddTests}\` }], isError: true };
        }
        return { content: [{ type: "text", text: content }] };
      }

      case "get_next_feature": {
        const data = getFeaturesData();
        const next = data.features.find((f) => f.status === "not-started");
        if (!next) {
          return { content: [{ type: "text", text: "All features are done! No remaining not-started features." }] };
        }
        return {
          content: [
            {
              type: "text",
              text: [
                \`## Next Feature: \${next.title}\`,
                \`\`,
                \`- **Slug:** \${next.slug}\`,
                \`- **Stories:** \${next.storyCount}\`,
                \`- **Story Points:** \${next.totalStoryPoints}\`,
                \`\`,
                \`### Files\`,
                \`- Specs: \${next.files.specs}\`,
                \`- Requirements: \${next.files.requirements}\`,
                next.files.tddTests ? \`- TDD Tests: \${next.files.tddTests}\` : null,
                \`- Prompt: \${next.files.prompt}\`,
                \`\`,
                \`Use get_feature_specs or get_requirements to read the details.\`,
              ]
                .filter(Boolean)
                .join("\\n"),
            },
          ],
        };
      }

      case "validate_implementation": {
        const feature = findFeature(args.feature);
        if (!feature) {
          return { content: [{ type: "text", text: \`Feature not found: \${args.feature}\` }], isError: true };
        }
        const reqPath = resolve(REPO_ROOT, feature.files.requirements);
        const content = readText(reqPath);
        if (!content) {
          return { content: [{ type: "text", text: \`requirements.md not found at \${feature.files.requirements}\` }], isError: true };
        }
        return {
          content: [
            {
              type: "text",
              text: [
                \`# Validation Checklist  -  \${feature.title}\`,
                \`\`,
                \`Go through each requirement below and verify it is satisfied in the implementation.\`,
                \`\`,
                content,
              ].join("\\n"),
            },
          ],
        };
      }

      case "mark_feature_done": {
        const data = getFeaturesData();
        const tracker = getTrackerData();
        const featureIndex = data.features.findIndex(
          (f) =>
            f.slug === (args.feature || "").toLowerCase().trim() ||
            f.title.toLowerCase() === (args.feature || "").toLowerCase().trim() ||
            f.id.toString() === (args.feature || "").trim()
        );
        if (featureIndex === -1) {
          return { content: [{ type: "text", text: \`Feature not found: \${args.feature}\` }], isError: true };
        }
        const now = new Date().toISOString();
        const feature = data.features[featureIndex];
        const taskId = feature.taskId || \`FEATURE-\${feature.id}\`;
        data.features[featureIndex].status = "done";
        tracker.tasks[taskId] = {
          ...(tracker.tasks[taskId] || {}),
          status: "COMPLETED",
          title: feature.title,
          featureId: feature.id,
          slug: feature.slug,
          updatedAt: now,
        };
        tracker.trackerVersion = Number(tracker.trackerVersion || 1) + 1;
        tracker.updatedAt = now;
        writeFileSync(FEATURES_JSON, JSON.stringify(data, null, 2), "utf-8");
        writeFileSync(TRACKER_JSON, JSON.stringify(tracker, null, 2), "utf-8");
        return {
          content: [
            {
              type: "text",
              text: \`Marked "\${data.features[featureIndex].title}" as done in features.json and COMPLETED in tracker.json.\`,
            },
          ],
        };
      }

      case "get_project_context": {
        const projectMd = readText(resolve(DEVX_DIR, "project.md")) || "project.md not found.";
        const workflowMd = readText(resolve(DEVX_DIR, "workflow.md")) || "workflow.md not found.";
        return {
          content: [
            {
              type: "text",
              text: projectMd + "\\n\\n---\\n\\n" + workflowMd,
            },
          ],
        };
      }

      default:
        return { content: [{ type: "text", text: \`Unknown tool: \${name}\` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: \`Error: \${error.message || error}\` }],
      isError: true,
    };
  }
});

//  Start 

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server failed to start:", error);
  process.exit(1);
});
`;
}

function generateMcpPackageJson(projectName: string): string {
  const safeName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "devx-project";

  return JSON.stringify(
    {
      name: `${safeName}-mcp-server`,
      version: "1.0.0",
      description: `Astra MCP server for ${projectName} specs`,
      type: "module",
      main: "server.js",
      scripts: {
        start: "node server.js",
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.12.1",
      },
    },
    null,
    2,
  );
}

function generateCommandImplementNext(): string {
  return `# DevX Command: implement-next

Resolve the first feature in \`specs/.devx/tracker.json\` with status \`PENDING\`, then implement only that feature from \`specs/.devx/features.json\`.

Guardrails:
- Run \`bash specs/.devx/validate-tracking.sh\` before selecting or implementing a feature.
- Do not use the currently open editor tab to infer the feature.
- Do not implement DevX tooling, init scripts, generators, or unrelated specs unless the selected feature slug points there.
- Read workspace context, feature specs, requirements, and prompt before changing code.
- Implement one requirement at a time and validate against \`requirements.md\`.
- Mark only the selected feature as \`done\` after validation passes.
`;
}

function generateCommandAutopilot(): string {
  return `# DevX Command: autopilot

Implement remaining features in sequence, stopping when the optional max feature count is reached.

Optional input:
- \`max-features\`

Guardrails:
- Run \`bash specs/.devx/validate-tracking.sh\` before selecting each feature.
- Stop when code, specs, or tracking files are uncommitted or unpushed.
- Implement and validate one feature at a time.
- Mark a feature \`done\` only after all requirements pass.
- Commit completed code and \`.devx\` tracking updates before continuing to the next batch.
`;
}

function generateCommandImplementFeature(): string {
  return `# DevX Command: implement-feature

Implement the explicitly selected feature slug.

Required input:
- \`feature-slug\`

Guardrails:
- Run \`bash specs/.devx/validate-tracking.sh\` before implementation.
- Only work inside the selected feature scope.
- Do not modify unrelated specs or DevX tooling.
- Create an implementation plan first.
- Validate every requirement before marking the feature done.
`;
}

function generateCommandValidateFeature(): string {
  return `# DevX Command: validate-feature

Validate the explicitly selected feature slug against its generated requirements.

Required input:
- \`feature-slug\`

Output:
- A pass/fail report for each requirement.
- A short list of missing or partial implementation gaps.
- A recommendation on whether the feature can be marked \`done\`.

Before validation, run \`bash specs/.devx/validate-tracking.sh\`.
`;
}

function generateTrackingValidationScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
SPECS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SPECS_DIR/.." && pwd)"
FEATURES_FILE="$SCRIPT_DIR/features.json"
TRACKER_FILE="$SCRIPT_DIR/tracker.json"
GENERATION_FILE="$SCRIPT_DIR/generation.json"
ALLOW_DIRTY="\${DEVX_ALLOW_DIRTY:-0}"

if [ "\${1:-}" = "--allow-dirty" ]; then
  ALLOW_DIRTY=1
fi

set +e
node - "$FEATURES_FILE" "$TRACKER_FILE" "$GENERATION_FILE" "$SPECS_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const [featuresFile, trackerFile, generationFile, specsDir] = process.argv.slice(2);
const allowedStatuses = new Set(["not-started", "in-progress", "done", "blocked", "needs-review"]);
const trackerStatuses = new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NEEDS_REVIEW"]);
const issues = [];
const repairs = [];
const now = new Date().toISOString();

function titleFromSlug(slug) {
  return slug.replace(/[-_]+/g, " ").replace(/\\b\\w/g, (char) => char.toUpperCase());
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function trackerStatusFromFeatureStatus(status) {
  if (status === "done") return "COMPLETED";
  if (status === "in-progress") return "IN_PROGRESS";
  if (status === "blocked") return "BLOCKED";
  if (status === "needs-review") return "NEEDS_REVIEW";
  return "PENDING";
}

function featureStatusFromTrackerStatus(status) {
  if (status === "COMPLETED") return "done";
  if (status === "IN_PROGRESS") return "in-progress";
  if (status === "BLOCKED") return "blocked";
  if (status === "NEEDS_REVIEW") return "needs-review";
  return "not-started";
}

const data = readJson(featuresFile, { version: "1.0", generatedAt: now, features: [] });
if (!Array.isArray(data.features)) {
  data.features = [];
  repairs.push("Recreated missing features array.");
}
const tracker = readJson(trackerFile, { trackerVersion: 1, updatedAt: now, tasks: {} });
if (!tracker || typeof tracker !== "object") {
  issues.push("tracker.json is invalid JSON.");
}
if (!tracker.tasks || typeof tracker.tasks !== "object" || Array.isArray(tracker.tasks)) {
  tracker.tasks = {};
  repairs.push("Recreated missing tracker tasks object.");
}
if (typeof tracker.trackerVersion !== "number") {
  tracker.trackerVersion = 1;
  repairs.push("Initialized trackerVersion.");
}
const generation = readJson(generationFile, {
  generationId: "GEN-LOCAL",
  generatedAt: data.generatedAt || now,
  trackerVersion: tracker.trackerVersion,
  taskCount: data.features.length,
});

const specDirs = fs.existsSync(specsDir)
  ? fs.readdirSync(specsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== ".devx")
      .map((entry) => entry.name)
  : [];
const dirsWithSpecs = new Set(
  specDirs.filter((slug) => fs.existsSync(path.join(specsDir, slug, "specs.md"))),
);

const seenIds = new Set();
const seenSlugs = new Set();
const seenPaths = new Set();
const nextFeatures = [];
let trackerChanged = false;

for (const feature of data.features) {
  const slug = String(feature.slug || "").trim();
  const id = feature.id;
  if (!slug) {
    issues.push(\`Feature "\${feature.title || id || "unknown"}" is missing a slug and was skipped.\`);
    continue;
  }
  if (seenIds.has(id) || seenSlugs.has(slug)) {
    issues.push(\`Duplicate tracking entry removed for slug "\${slug}".\`);
    repairs.push(\`Removed duplicate tracking entry for \${slug}.\`);
    continue;
  }
  seenIds.add(id);
  seenSlugs.add(slug);
  const taskId = String(feature.taskId || \`FEATURE-\${id || slug}\`);

  const files = {
    specs: feature.files?.specs || \`specs/\${slug}/specs.md\`,
    requirements: feature.files?.requirements || \`specs/\${slug}/requirements.md\`,
    ...(feature.files?.tddTests ? { tddTests: feature.files.tddTests } : {}),
    prompt: feature.files?.prompt || \`specs/\${slug}/prompt.md\`,
  };

  for (const filePath of Object.values(files)) {
    if (seenPaths.has(filePath)) issues.push(\`Duplicate file mapping detected: \${filePath}\`);
    seenPaths.add(filePath);
  }

  for (const requiredPath of [files.specs, files.requirements, files.prompt]) {
    if (!fs.existsSync(path.join(path.dirname(specsDir), requiredPath))) {
      issues.push(\`Missing tracked file for "\${slug}": \${requiredPath}\`);
    }
  }

  const existingTask = tracker.tasks[taskId] || {};
  const taskStatus = trackerStatuses.has(existingTask.status)
    ? existingTask.status
    : trackerStatusFromFeatureStatus(feature.status);
  if (!trackerStatuses.has(existingTask.status)) trackerChanged = true;
  const status = allowedStatuses.has(feature.status)
    ? feature.status
    : featureStatusFromTrackerStatus(taskStatus);
  if (status !== feature.status) repairs.push(\`Normalized invalid status for \${slug}.\`);
  const nextTask = {
    ...existingTask,
    status: taskStatus,
    title: feature.title,
    featureId: id,
    slug,
    updatedAt: existingTask.updatedAt || data.generatedAt || now,
  };
  if (JSON.stringify(tracker.tasks[taskId]) !== JSON.stringify(nextTask)) {
    tracker.tasks[taskId] = nextTask;
    trackerChanged = true;
  }
  nextFeatures.push({ ...feature, taskId, slug, status, files });
}

const maxId = nextFeatures.reduce((max, feature) => {
  return typeof feature.id === "number" && feature.id > max ? feature.id : max;
}, 0);
let syntheticId = maxId + 1;
for (const slug of dirsWithSpecs) {
  if (seenSlugs.has(slug)) continue;
  const entry = {
    id: syntheticId++,
    title: titleFromSlug(slug),
    slug,
    state: "needs-review",
    status: "needs-review",
    storyCount: 0,
    totalStoryPoints: 0,
    files: {
      specs: \`specs/\${slug}/specs.md\`,
      requirements: \`specs/\${slug}/requirements.md\`,
      prompt: \`specs/\${slug}/prompt.md\`,
    },
    userStories: [],
  };
  const taskId = \`FEATURE-\${entry.id}\`;
  entry.taskId = taskId;
  tracker.tasks[taskId] = {
    status: "NEEDS_REVIEW",
    title: entry.title,
    featureId: entry.id,
    slug,
    updatedAt: now,
  };
  trackerChanged = true;
  nextFeatures.push(entry);
  repairs.push(\`Added missing tracking entry for orphan specs folder \${slug}.\`);
}

const nextData = {
  ...data,
  generatedAt: data.generatedAt || new Date().toISOString(),
  totalFeatures: nextFeatures.length,
  features: nextFeatures,
};
const nextGeneration = {
  ...generation,
  trackerVersion: tracker.trackerVersion,
  taskCount: nextFeatures.length,
};
if (trackerChanged) {
  tracker.trackerVersion += 1;
  tracker.updatedAt = now;
  nextGeneration.trackerVersion = tracker.trackerVersion;
}
const before = fs.existsSync(featuresFile) ? fs.readFileSync(featuresFile, "utf8") : "";
const after = JSON.stringify(nextData, null, 2) + "\\n";
if (before !== after) {
  fs.writeFileSync(featuresFile, after);
}
const trackerBefore = fs.existsSync(trackerFile) ? fs.readFileSync(trackerFile, "utf8") : "";
const trackerAfter = JSON.stringify(tracker, null, 2) + "\\n";
if (trackerBefore !== trackerAfter) {
  fs.writeFileSync(trackerFile, trackerAfter);
}
const generationBefore = fs.existsSync(generationFile) ? fs.readFileSync(generationFile, "utf8") : "";
const generationAfter = JSON.stringify(nextGeneration, null, 2) + "\\n";
if (generationBefore !== generationAfter) {
  fs.writeFileSync(generationFile, generationAfter);
}

console.log(JSON.stringify({
  ok: issues.length === 0,
  changed: before !== after || trackerBefore !== trackerAfter || generationBefore !== generationAfter,
  issues,
  repairs,
}, null, 2));
if (issues.length > 0) process.exitCode = 2;
NODE
node_status=$?
set -e
if [ "$node_status" -ne 0 ] && [ "$node_status" -ne 2 ]; then
  exit "$node_status"
fi

if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  upstream="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -n "$upstream" ]; then
    git -C "$REPO_ROOT" fetch --quiet || true
    remote_tracker="$(mktemp)"
    if git -C "$REPO_ROOT" show "$upstream:specs/.devx/tracker.json" > "$remote_tracker" 2>/dev/null; then
      set +e
      node - "$TRACKER_FILE" "$remote_tracker" <<'NODE'
const fs = require("fs");
const [localFile, remoteFile] = process.argv.slice(2);
const local = JSON.parse(fs.readFileSync(localFile, "utf8"));
const remote = JSON.parse(fs.readFileSync(remoteFile, "utf8"));
const localTasks = local.tasks || {};
const remoteTasks = remote.tasks || {};
const unsyncedCompleted = [];
const merged = { ...remoteTasks };
let changed = false;

function time(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

for (const [taskId, localTask] of Object.entries(localTasks)) {
  const remoteTask = remoteTasks[taskId];
  const localTime = time(localTask.updatedAt);
  const remoteTime = time(remoteTask && remoteTask.updatedAt);
  if (localTime > remoteTime && localTask.status === "COMPLETED") {
    unsyncedCompleted.push(taskId);
  }
  merged[taskId] = localTime >= remoteTime ? localTask : remoteTask;
  if (JSON.stringify(localTasks[taskId]) !== JSON.stringify(merged[taskId])) changed = true;
}

for (const [taskId, remoteTask] of Object.entries(remoteTasks)) {
  if (!localTasks[taskId]) {
    merged[taskId] = remoteTask;
    changed = true;
  }
}

if (unsyncedCompleted.length > 0) {
  console.error("DevX tracking preflight stopped because completed local tasks are newer than the repository tracker.");
  console.error("Push completed code and specs/.devx/tracker.json before running code generation.");
  console.error("Unsynced completed tasks: " + unsyncedCompleted.join(", "));
  process.exit(5);
}

if (changed || local.trackerVersion !== remote.trackerVersion) {
  const next = {
    ...local,
    trackerVersion: Math.max(Number(local.trackerVersion || 1), Number(remote.trackerVersion || 1)) + 1,
    updatedAt: new Date().toISOString(),
    tasks: merged,
  };
  fs.writeFileSync(localFile, JSON.stringify(next, null, 2) + "\\n");
  console.log("Auto-merged specs/.devx/tracker.json with repository tracker state.");
}
NODE
      remote_status=$?
      set -e
      rm -f "$remote_tracker"
      if [ "$remote_status" -ne 0 ]; then
        exit "$remote_status"
      fi
    else
      rm -f "$remote_tracker"
    fi
  fi
  branch_state="$(git -C "$REPO_ROOT" status -sb 2>/dev/null | head -n 1 || true)"
  case "$branch_state" in
    *behind*|*diverged*)
      if [ "$ALLOW_DIRTY" != "1" ]; then
        printf '%s\\n' "DevX tracking preflight stopped because this branch is behind or diverged."
        printf '%s\\n' "Pull/rebase and resolve tracking updates before running code generation."
        printf '%s\\n' "$branch_state"
        exit 4
      fi
      ;;
  esac
  if printf '%s' "$branch_state" | grep -q 'ahead'; then
    if [ "$ALLOW_DIRTY" != "1" ]; then
      printf '%s\\n' "DevX tracking preflight stopped because this branch has local commits not pushed to the repository."
      printf '%s\\n' "Push completed code and specs/.devx tracking updates before running code generation."
      printf '%s\\n' "$branch_state"
      exit 5
    fi
  fi
  dirty="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)"
  if [ -n "$dirty" ] && [ "$ALLOW_DIRTY" != "1" ]; then
    printf '%s\\n' "DevX tracking preflight stopped because the workspace has uncommitted changes."
    printf '%s\\n' "Commit or stash completed code and tracking updates before running code generation."
    printf '%s\\n\\n' "Use DEVX_ALLOW_DIRTY=1 only when you intentionally want to override this guard."
    printf '%s\\n' "$dirty"
    exit 3
  fi
fi

if [ "$node_status" -eq 2 ]; then
  printf '%s\\n' "DevX tracking preflight repaired what it could, but inconsistencies remain."
  printf '%s\\n' "Review specs/.devx/features.json and generated spec folders before continuing."
  exit 2
fi

printf '%s\\n' "DevX tracking preflight passed."
`;
}

function generateDevxCommandScript(enableTdd: boolean): string {
  const tddPromptLine = enableTdd
    ? "- TDD tests: $tdd_path"
    : "";
  const tddRuleLine = enableTdd
    ? "- Follow the generated TDD guidance before writing production code where applicable."
    : "";

  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
FEATURES_FILE="$SCRIPT_DIR/features.json"
TRACKER_FILE="$SCRIPT_DIR/tracker.json"
TRACKING_VALIDATOR="$SCRIPT_DIR/validate-tracking.sh"

usage() {
  cat <<'USAGE'
Usage:
  bash specs/.devx/devx-command.sh autopilot [max-features]
  bash specs/.devx/devx-command.sh implement-next
  bash specs/.devx/devx-command.sh implement-feature <feature-slug>
  bash specs/.devx/devx-command.sh validate-feature <feature-slug>
USAGE
}

ensure_features_file() {
  if [ ! -f "$FEATURES_FILE" ]; then
    echo "features.json not found at $FEATURES_FILE" >&2
    exit 1
  fi
}

run_tracking_preflight() {
  if [ -f "$TRACKING_VALIDATOR" ]; then
    bash "$TRACKING_VALIDATOR"
  else
    echo "Tracking validator not found at $TRACKING_VALIDATOR" >&2
    exit 1
  fi
}

feature_field() {
  local slug="$1"
  local field="$2"
  node - "$FEATURES_FILE" "$slug" "$field" <<'NODE'
const fs = require("fs");
const [file, slug, field] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const feature = (data.features || []).find((item) => item.slug === slug);
if (!feature) process.exit(2);
const value = field.split(".").reduce((acc, key) => acc && acc[key], feature);
if (value !== undefined && value !== null) process.stdout.write(String(value));
NODE
}

resolve_next_slug() {
  ensure_features_file
  node - "$FEATURES_FILE" "$TRACKER_FILE" <<'NODE'
const fs = require("fs");
const [featuresFile, trackerFile] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(featuresFile, "utf8"));
const tracker = fs.existsSync(trackerFile)
  ? JSON.parse(fs.readFileSync(trackerFile, "utf8"))
  : { tasks: {} };
const feature = (data.features || []).find((item) => {
  const taskId = item.taskId || \`FEATURE-\${item.id}\`;
  const taskStatus = tracker.tasks?.[taskId]?.status;
  return taskStatus ? taskStatus === "PENDING" : item.status === "not-started";
});
if (!feature) {
  console.error("No feature with tracker status PENDING was found.");
  process.exit(1);
}
process.stdout.write(feature.slug);
NODE
}

assert_feature_exists() {
  local slug="$1"
  if ! feature_field "$slug" "title" >/dev/null 2>&1; then
    echo "Feature not found in features.json: $slug" >&2
    exit 1
  fi
}

emit_implementation_prompt() {
  local slug="$1"
  assert_feature_exists "$slug"
  local title specs_path requirements_path prompt_path tdd_path
  title="$(feature_field "$slug" "title")"
  specs_path="$(feature_field "$slug" "files.specs")"
  requirements_path="$(feature_field "$slug" "files.requirements")"
  prompt_path="$(feature_field "$slug" "files.prompt")"
  tdd_path="$(feature_field "$slug" "files.tddTests" || true)"

  cat <<PROMPT
Read AGENTS.md and specs/.devx/workspace-context.md first.

Selected feature slug: $slug
Selected feature title: $title

You must only implement this selected feature:
- Specs: $specs_path
- Requirements: $requirements_path
- Prompt: $prompt_path
${tddPromptLine}

Strict guardrails:
- Do not infer the feature from the currently open editor tab.
- Do not implement DevX tooling, init.sh, specs generation, workspace bootstrap, or unrelated specs unless this selected feature explicitly requires it.
- Do not modify other feature folders except when a shared implementation file must change to satisfy this feature.
- Create an implementation plan first.
- Implement one requirement at a time.
- Validate the implementation against every item in $requirements_path.
${tddRuleLine}
- If all requirements pass, update only this feature's status in specs/.devx/features.json to "done" and its entry in specs/.devx/tracker.json to "COMPLETED" with a fresh updatedAt timestamp.

Now read the selected feature files and begin with the implementation plan.
PROMPT
}

emit_validation_prompt() {
  local slug="$1"
  assert_feature_exists "$slug"
  local title specs_path requirements_path
  title="$(feature_field "$slug" "title")"
  specs_path="$(feature_field "$slug" "files.specs")"
  requirements_path="$(feature_field "$slug" "files.requirements")"

  cat <<PROMPT
Read AGENTS.md and specs/.devx/workspace-context.md first.

Validate this selected feature only:
- Slug: $slug
- Title: $title
- Specs: $specs_path
- Requirements: $requirements_path

Validation rules:
- Check every requirement in $requirements_path.
- Verify behavior in actual implementation code, not just file existence.
- Report PASS/FAIL for each requirement.
- Do not mark the feature done unless every requirement passes.
- Do not validate unrelated features.
PROMPT
}

emit_autopilot_prompt() {
  local max_features="\${1:-all}"
  cat <<PROMPT
Read AGENTS.md and specs/.devx/workspace-context.md first.

Run DevX autopilot code generation.

Scope:
- Maximum features this session: $max_features
- Source of truth: specs/.devx/features.json, specs/.devx/tracker.json, and each specs/<slug>/ folder

Mandatory loop:
1. Pick the first feature whose tracker status is "PENDING".
2. Read its specs.md, requirements.md, prompt.md, and tdd-tests.md when present.
3. Implement only that feature, one requirement at a time.
4. Validate every requirement against actual implementation code.
5. If all requirements pass, mark only that feature as "done" in specs/.devx/features.json and "COMPLETED" in specs/.devx/tracker.json.
6. Stop if tracking becomes dirty, validation fails repeatedly, or the max feature limit is reached.

Do not start new work while uncommitted or unpushed code or tracking changes exist.
PROMPT
}

main() {
  local command="\${1:-}"
  local slug="\${2:-}"
  case "$command" in
    autopilot|implement-next|implement-feature|validate-feature) run_tracking_preflight ;;
    *) ;;
  esac
  case "$command" in
    autopilot)
      emit_autopilot_prompt "\${slug:-all}"
      ;;
    implement-next)
      slug="$(resolve_next_slug)"
      emit_implementation_prompt "$slug"
      ;;
    implement-feature)
      if [ -z "$slug" ]; then
        echo "Missing feature slug." >&2
        usage
        exit 1
      fi
      emit_implementation_prompt "$slug"
      ;;
    validate-feature)
      if [ -z "$slug" ]; then
        echo "Missing feature slug." >&2
        usage
        exit 1
      fi
      emit_validation_prompt "$slug"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
`;
}

function generateMcpReadme(): string {
  return `# Astra MCP Server

A lightweight MCP (Model Context Protocol) server that exposes your project specs to AI tools.

## Setup

\\\`\\\`\\\`bash
# Run the init script which installs MCP dependencies automatically
bash specs/.devx/init.sh

# Or install MCP dependencies manually
cd specs/.devx/mcp
npm install
\\\`\\\`\\\`

> If the cloned repo does not preserve execute permissions, keep using \\\`bash specs/.devx/init.sh\\\` and \\\`bash specs/.devx/discover-workspace.sh\\\`.
> Local MCP dependencies under \\\`specs/.devx/mcp/node_modules\\\` are ignored by the generated \\\`.gitignore\\\` files.

## Usage

The server runs over stdio and is designed to be configured in your AI tool:

### Claude Code

Add to \\\`.claude/settings.json\\\`:
\\\`\\\`\\\`json
{
  "mcpServers": {
    "devx-specs": {
      "command": "node",
      "args": ["specs/.devx/mcp/server.js"]
    }
  }
}
\\\`\\\`\\\`

### Codex

Codex-compatible agents can read repo-level guidance from \\\`AGENTS.md\\\`.

> The \\\`init.sh\\\` script creates \\\`AGENTS.md\\\` automatically from \\\`project.md\\\` and \\\`workflow.md\\\`.

### Cursor

Add to \\\`.cursor/mcp.json\\\`:
\\\`\\\`\\\`json
{
  "mcpServers": {
    "devx-specs": {
      "command": "node",
      "args": ["specs/.devx/mcp/server.js"]
    }
  }
}
\\\`\\\`\\\`

### VS Code

Add to \\\`.vscode/settings.json\\\`:
\\\`\\\`\\\`json
{
  "mcp": {
    "servers": {
      "devx-specs": {
        "command": "node",
        "args": ["specs/.devx/mcp/server.js"]
      }
    }
  }
}
\\\`\\\`\\\`

### Kiro

Add to \\\`.kiro/settings/mcp.json\\\`:
\\\`\\\`\\\`json
{
  "mcpServers": {
    "devx-specs": {
      "command": "node",
      "args": ["specs/.devx/mcp/server.js"]
    }
  }
}
\\\`\\\`\\\`

> The \\\`init.sh\\\` script creates this file automatically. Kiro's steering context is also written to \\\`.kiro/steering/devx-context.md\\\`.

## Available Tools

| Tool | Description |
|------|-------------|
| \\\`list_features\\\` | List all features with status from features.json |
| \\\`get_feature_specs\\\` | Get specs.md content for a feature by slug or title |
| \\\`get_requirements\\\` | Get requirements.md checklist for a feature |
| \\\`get_tdd_tests\\\` | Get tdd-tests.md for a feature (if TDD enabled) |
| \\\`get_next_feature\\\` | Suggest next feature to implement (first "not-started") |
| \\\`validate_implementation\\\` | Return requirements checklist for validation |
| \\\`mark_feature_done\\\` | Update feature status in features.json and tracker.json |
| \\\`get_project_context\\\` | Return project.md + workflow.md content |
`;
}

function generateDevxGitignore(): string {
  return `mcp/node_modules/
mcp/package-lock.json
`;
}

function generateMcpGitignore(): string {
  return `node_modules/
package-lock.json
`;
}

//  Skills Generators 

function resolveLlmProvider(value?: string): string {
  const raw = (value || process.env.DEVX_LLM_PROVIDER || "claude").trim().toLowerCase();
  if (!raw) return "claude";
  return raw;
}

function toDisplayLlmName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude") return "Claude";
  if (normalized === "copilot") return "GitHub Copilot";
  if (normalized === "codex") return "OpenAI Codex";
  if (normalized === "cursor") return "Cursor";
  if (normalized === "windsurf") return "Windsurf";
  return provider;
}

function hasGoldenContext(goldenRepoContext?: GoldenRepoContext): boolean {
  return Boolean(
    goldenRepoContext?.repoId ||
      goldenRepoContext?.repoName ||
      goldenRepoContext?.organization ||
      goldenRepoContext?.project ||
      (goldenRepoContext?.selectedPaths && goldenRepoContext.selectedPaths.length > 0),
  );
}

function buildGoldenRepoSection(goldenRepoContext?: GoldenRepoContext): string {
  if (!hasGoldenContext(goldenRepoContext)) {
    return `## Golden Repository Context

Golden repository context is not configured for this project.
Use local repository conventions as the primary reference source.`;
  }

  const selectedPaths = goldenRepoContext?.selectedPaths?.filter(Boolean) ?? [];
  const uiPackage = goldenRepoContext?.uiDesignPackage;
  const selectedPathLines =
    selectedPaths.length > 0
      ? selectedPaths.map((path) => `- ${path}`).join("\n")
      : "- No explicit golden paths provided. Discover relevant files from current feature scope.";
  const uiPackageLines = uiPackage
    ? `\nLocal UI/UX design package:\n- Consolidated guide: \`specs/.devx/skills/ui-skill/golden-ui-design-system.md\`\n- Raw source preservation: \`specs/.devx/skills/ui-skill/golden-ui-design-sources.md\`\n- Source files extracted: ${uiPackage.sourceFiles.length}\n- Generated at: ${uiPackage.generatedAt}\n\nFor UI work, use these local artifacts first. Do not require live Golden Repository access inside the IDE.`
    : "";

  return `## Golden Repository Context

- Repo name: ${goldenRepoContext?.repoName || "Unknown"}
- Organization: ${goldenRepoContext?.organization || "Unknown"}
- Project: ${goldenRepoContext?.project || "Unknown"}

Preferred reference paths:
${selectedPathLines}
${uiPackageLines}

Follow golden-repo patterns first when choosing structure, naming, and implementation style.`;
}

function buildLlmSection(llmProvider: string): string {
  return `## LLM Runtime Context

- Active LLM provider: ${toDisplayLlmName(llmProvider)} (${llmProvider})
- Apply this skill as structured execution guidance for the active LLM.
- Keep outputs deterministic, explicit, and aligned with project specs and golden-repo conventions.`;
}

function generateSkillDocument(options: {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools: string;
  body: string;
  goldenRepoContext?: GoldenRepoContext;
  llmProvider: string;
}): string {
  const argumentHintLine = options.argumentHint
    ? `argument-hint: "${options.argumentHint}"\n`
    : "";

  return `---
name: ${options.name}
description: ${options.description}
user-invocable: true
${argumentHintLine}allowed-tools: ${options.allowedTools}
---

${buildLlmSection(options.llmProvider)}

${buildGoldenRepoSection(options.goldenRepoContext)}

${options.body}`;
}

/**
 * Minimal wrapper used by the LLM-generated skills path.
 * Maps each skill slug to its canonical description + allowed-tools,
 * then delegates to generateSkillDocument for consistent YAML front-matter.
 */
function buildSkillDocument(options: {
  name: string;
  body: string;
  goldenRepoContext?: GoldenRepoContext;
  llmProvider: string;
}): string {
  const SKILL_META: Record<string, { description: string; argumentHint?: string; allowedTools: string }> = {
    implement: {
      description:
        "Implement a feature following the Spec-Driven Development workflow. Reads specs, requirements, and TDD tests to guide implementation.",
      argumentHint: "[feature-slug]",
      allowedTools: "Read, Grep, Glob, Edit, Write, Bash",
    },
    validate: {
      description:
        "Validate current code against the requirements checklist for a feature. Produces a pass/fail report.",
      argumentHint: "[feature-slug]",
      allowedTools: "Read, Grep, Glob, Bash",
    },
    next: {
      description:
        "Show the next unimplemented feature from the spec index with its file paths and summary.",
      allowedTools: "Read, Bash",
    },
    autopilot: {
      description:
        "Automatically implement all remaining features end-to-end. Picks the next feature, implements it, validates, marks done, and repeats.",
      argumentHint: "[max-features]",
      allowedTools: "Read, Grep, Glob, Edit, Write, Bash",
    },
    "ui-skill": {
      description:
        "Implement high-quality UI changes using local DevX UI/UX design-system artifacts extracted from the Golden Repository when available.",
      argumentHint: "[feature-slug or UI task]",
      allowedTools: "Read, Grep, Glob, Edit, Write, Bash",
    },
  };

  const meta = SKILL_META[options.name] ?? {
    description: `DevX skill: ${options.name}`,
    allowedTools: "Read, Grep, Glob, Edit, Write, Bash",
  };

  return generateSkillDocument({
    name: options.name,
    description: meta.description,
    argumentHint: meta.argumentHint,
    allowedTools: meta.allowedTools,
    body: options.body,
    goldenRepoContext: options.goldenRepoContext,
    llmProvider: options.llmProvider,
  });
}

function generateFeaturePrompt(
  result: SpecsGenerationResult,
  feature: SpecsGenerationFeature | undefined,
  enableTdd: boolean,
  architectureStyle: "monolith" | "microservices",
  routingPlan?: FeatureRoutingPlan,
): string {
  const slug = slugifyFeatureTitle(result.featureTitle, result.featureId);

  const storyList = feature?.userStories
    .map(
      (s) =>
        `- **${cleanRichText(s.title)}**${s.storyPoints ? ` (${s.storyPoints} pts)` : ""}${s.acceptanceCriteria ? `\n  Acceptance:\n${cleanRichText(s.acceptanceCriteria)}` : ""}`,
    )
    .join("\n") || "See specs.md for details.";

  const tddInstructions = enableTdd
    ? `
## TDD Instructions

This feature uses Test-Driven Development. For each requirement:

1. **Red**  -  Write a failing test first (see \`tdd-tests.md\` for test specifications)
2. **Green**  -  Write minimum code to pass the test
3. **Refactor**  -  Clean up while keeping tests green

Reference: \`specs/${slug}/tdd-tests.md\`
`
    : "";
  const repoRoutingBlock =
    architectureStyle === "microservices"
        ? `## Multi-Repo Preparation

- Run \`bash specs/.devx/discover-workspace.sh\` from the cloned target workspace before implementation
- Review \`specs/.devx/feature-routing.json\` for the generated repo recommendation
- Review \`specs/.devx/workspace-repos.json\` to identify the most likely owning repo
- Review \`specs/.devx/workspace-context.md\` for brownfield notes and repo summaries
- If no existing repo cleanly owns this feature, record the proposal in \`specs/.devx/repo-plans.json\`

## Recommended Repo Routing

- **Specs home repo type:** \`${routingPlan?.specsHomeRepoType || "ui"}\`
- **Suggested owner repo type:** \`${routingPlan?.ownerRepoType || "unknown"}\`
- **Impacted repo types:** ${routingPlan?.impactedRepoTypes.map((repoType) => `\`${repoType}\``).join(", ") || "_Review workspace discovery output_"}
- **Repo types to check in the workspace:** ${routingPlan?.repoTypesToCheck.map((repoType) => `\`${repoType}\``).join(", ") || "_Review workspace discovery output_"}
- **Create a repo plan if missing:** ${routingPlan?.repoPlanCandidates.length ? routingPlan.repoPlanCandidates.map((repoType) => `\`${repoType}\``).join(", ") : "_No additional repo type is suggested by default_"}

### Why this routing was suggested
${routingPlan?.rationale.map((line) => `- ${line}`).join("\n") || "- Review the workspace inventory and decide the owner repo before implementation."}
`
      : "";

  return `# Implementation Prompt  -  ${result.featureTitle}

> Use this prompt with any AI-assisted development tool to implement this feature.
> Generated by Astra Spec-Driven Development.

## Context

You are implementing the **${result.featureTitle}** feature.
Follow the specification exactly. Do not add features not described in the spec.

## Files to Reference

- **Specification:** \`specs/${slug}/specs.md\`
- **Requirements Checklist:** \`specs/${slug}/requirements.md\`
${enableTdd ? `- **TDD Test Specs:** \`specs/${slug}/tdd-tests.md\`\n` : ""}
## User Stories

${storyList}

${repoRoutingBlock}

## Implementation Instructions

1. Read \`specs/${slug}/specs.md\` thoroughly before writing any code
2. Implement each requirement from \`specs/${slug}/requirements.md\` one at a time
${enableTdd ? "3. Follow the TDD Red  ->  Green  ->  Refactor cycle for each requirement\n4. All tests must pass before moving to the next requirement\n" : "3. Validate each requirement as you implement it\n"}
## Constraints

- Do not deviate from the specification
- Do not add features or behaviors not in the spec
- Follow the project's established patterns and conventions
- Each acceptance criterion in requirements.md must be satisfied
${tddInstructions}
## Validation

After implementation, verify:
- [ ] All requirements in \`requirements.md\` are satisfied
- [ ] All user scenarios from \`specs.md\` work correctly
${enableTdd ? "- [ ] All TDD tests pass\n- [ ] Code has been refactored with tests still green\n" : ""}- [ ] No extra features were added beyond the spec
- [ ] Code follows project conventions
`;
}

function generateWorkspaceReposTemplate(): string {
  return JSON.stringify(
    {
      version: "1.0",
      workspaceRoot: ".",
      generatedAt: null,
      repos: [],
      sharedLibraries: [],
      discovery: {
        toolVersion: "1.0",
        unvalidatedRepos: [],
        missingRepos: [],
        warnings: [
          "Run `bash specs/.devx/discover-workspace.sh` in the target implementation workspace to populate this file.",
        ],
      },
    },
    null,
    2,
  );
}

function generateWorkspaceContextTemplate(): string {
  return `# Workspace Context

> This file is a placeholder until you run \`bash specs/.devx/discover-workspace.sh\` in the cloned target workspace.

## Next Step

1. Clone or open the target implementation workspace that contains the relevant repos
2. Run \`bash specs/.devx/discover-workspace.sh\`
3. Review \`specs/.devx/feature-routing.json\` against the generated repository inventory
4. Update repo ownership and repo-plan proposals as needed
`;
}

function generateRepoPlansTemplate(): string {
  return JSON.stringify(
    {
      version: "1.0",
      generatedAt: null,
      plans: [],
    },
    null,
    2,
  );
}

function generateFeatureRoutingJson(
  plans: FeatureRoutingPlan[],
  deliveryOrder: "ui-first" | "api-first" | null,
  today: string,
): string {
  return JSON.stringify(
    {
      version: "1.0",
      generatedAt: today,
      deliveryOrder: deliveryOrder || "ui-first",
      notes: [
        "Use this file as the initial routing recommendation before implementation.",
        "Confirm owner and impacted repos against workspace-repos.json after running discover-workspace.sh.",
        "If no matching repo exists, add a proposal to repo-plans.json instead of creating a new repo silently.",
      ],
      features: plans.map((plan) => ({
        featureId: plan.featureId,
        featureTitle: plan.featureTitle,
        slug: plan.slug,
        specsHomeRepoType: plan.specsHomeRepoType,
        ownerRepoType: plan.ownerRepoType,
        impactedRepoTypes: plan.impactedRepoTypes,
        repoTypesToCheck: plan.repoTypesToCheck,
        repoPlanCandidates: plan.repoPlanCandidates,
        rationale: plan.rationale,
        signals: plan.signals,
      })),
    },
    null,
    2,
  );
}

function generateWorkspaceDiscoveryScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"
DEVX_DIR="$ROOT_DIR/specs/.devx"
WORKSPACE_REPOS_FILE="$DEVX_DIR/workspace-repos.json"
WORKSPACE_CONTEXT_FILE="$DEVX_DIR/workspace-context.md"
REPO_PLANS_FILE="$DEVX_DIR/repo-plans.json"
MAX_DEPTH=4

mkdir -p "$DEVX_DIR"

timestamp_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

json_escape() {
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify(process.argv[1] || "").slice(1, -1))' "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json, sys; value = sys.argv[1] if len(sys.argv) > 1 else ""; print(json.dumps(value)[1:-1], end="")' "$1"
  else
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
  fi
}

csv_escape() {
  printf '%s' "$1" | sed 's/|/\\\\|/g'
}

join_csv() {
  local IFS=", "
  printf '%s' "$*"
}

is_discovery_excluded_path() {
  local candidate="$1"
  local normalized
  normalized="$(printf '%s' "$candidate" | sed 's#^\./##; s#//*#/#g')"

  case "$normalized" in
    specs/.devx|specs/.devx/*|.claude|.claude/*|.cursor|.cursor/*|.kiro|.kiro/*|.vscode|.vscode/*|.github|.github/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

collect_repo_roots() {
  if find "$ROOT_DIR" -maxdepth 1 -name ".git" -print -quit | grep -q .; then
    printf '.\n'
  fi

  find "$ROOT_DIR" -mindepth 1 -maxdepth "$MAX_DEPTH" -type d \\
    \\( -name .git -o -name node_modules -o -name dist -o -name build -o -name coverage -o -name .next -o -name .turbo -o -name .pnpm-store -o -name .yarn -o -name .idea -o -name .vscode -o -name __pycache__ \\) -prune -o \\
    \\( -name .git -o -name package.json -o -name pnpm-workspace.yaml -o -name pom.xml -o -name build.gradle -o -name build.gradle.kts -o -name Cargo.toml -o -name go.mod -o -name requirements.txt -o -name Dockerfile -o -name '*.csproj' -o -name '*.sln' \\) -print |
    while IFS= read -r marker; do
      repo_dir="$(dirname "$marker")"
      repo_rel="\${repo_dir#"$ROOT_DIR"/}"
      if [ "$repo_dir" = "$ROOT_DIR" ]; then
        repo_rel="."
      fi
      if ! is_discovery_excluded_path "$repo_rel"; then
        printf '%s\n' "$repo_dir"
      fi
    done | sort -u
}

list_repo_files() {
  local repo_abs="$1"
  local repo_rel
  repo_rel="\${repo_abs#"$ROOT_DIR"/}"
  if [ "$repo_abs" = "$ROOT_DIR" ]; then
    repo_rel="."
  fi
  if is_discovery_excluded_path "$repo_rel"; then
    return 0
  fi
  find "$repo_abs" -mindepth 1 -maxdepth 4 \\
    \\( -type d \\( -name .git -o -name node_modules -o -name dist -o -name build -o -name coverage -o -name .next -o -name .turbo -o -name .pnpm-store -o -name .yarn -o -name .idea -o -name .vscode -o -name __pycache__ \\) -prune \\) -o \\
    -type f -print |
    sed "s#^$repo_abs/##" |
    sort -u
}

detect_repo_type() {
  local rel_path="$1"
  local files="$2"
  local lower_rel
  lower_rel="$(printf '%s' "$rel_path" | tr '[:upper:]' '[:lower:]')"

  if printf '%s\n' "$lower_rel" | grep -Eq '(^|/)(lib|libs|shared|packages/shared|packages/ui)(/|$)'; then
    printf 'shared-lib'
  elif printf '%s\n' "$files" | grep -Eiq '(src/pages/|app/.+/page\\.|routes\\.tsx|router|page\\.(tsx|jsx|ts|js)$)'; then
    printf 'ui'
  elif printf '%s\n' "$files" | grep -Eiq '(worker|job|queue|consumer|processor)'; then
    printf 'worker'
  elif printf '%s\n' "$files" | grep -Eiq '(controller|route|routes|/api/|api/)'; then
    printf 'api'
  elif printf '%s\n' "$files" | grep -Eiq '\\.(tf|bicep)$'; then
    printf 'infra'
  else
    printf 'unknown'
  fi
}

detect_languages() {
  local files="$1"
  local langs=()

  printf '%s\n' "$files" | grep -Eq '\\.(ts|tsx)$' && langs+=("TypeScript")
  printf '%s\n' "$files" | grep -Eq '\\.(js|jsx)$' && langs+=("JavaScript")
  printf '%s\n' "$files" | grep -Eq '\\.cs$' && langs+=("C#")
  printf '%s\n' "$files" | grep -Eq '\\.java$' && langs+=("Java")
  printf '%s\n' "$files" | grep -Eq '\\.go$' && langs+=("Go")
  printf '%s\n' "$files" | grep -Eq '\\.py$' && langs+=("Python")

  if [ "\${#langs[@]}" -eq 0 ]; then
    return 0
  fi
  join_csv "\${langs[@]}"
}

detect_frameworks() {
  local files="$1"
  local frameworks=()

  printf '%s\n' "$files" | grep -Eq '\\.(tsx|jsx)$' && frameworks+=("React")
  printf '%s\n' "$files" | grep -Eiq '(^|/)app/.+/page\\.(tsx|jsx|ts|js)$|next\\.config' && frameworks+=("Next.js")
  printf '%s\n' "$files" | grep -Eq '\\.csproj$' && frameworks+=(".NET")
  printf '%s\n' "$files" | grep -Eq '^pom\\.xml$' && frameworks+=("Spring")
  printf '%s\n' "$files" | grep -Eiq '(controller|route|routes)' && frameworks+=("Express")

  if [ "\${#frameworks[@]}" -eq 0 ]; then
    return 0
  fi
  join_csv "\${frameworks[@]}"
}

detect_package_managers() {
  local files="$1"
  local managers=()

  printf '%s\n' "$files" | grep -Eq '^pnpm-lock\\.yaml$|^pnpm-workspace\\.yaml$' && managers+=("pnpm")
  printf '%s\n' "$files" | grep -Eq '^package-lock\\.json$' && managers+=("npm")
  printf '%s\n' "$files" | grep -Eq '^yarn\\.lock$' && managers+=("yarn")
  printf '%s\n' "$files" | grep -Eq '\\.csproj$' && managers+=("nuget")
  printf '%s\n' "$files" | grep -Eq '^pom\\.xml$' && managers+=("maven")
  printf '%s\n' "$files" | grep -Eq '^go\\.mod$' && managers+=("go")

  if [ "\${#managers[@]}" -eq 0 ]; then
    return 0
  fi
  join_csv "\${managers[@]}"
}

infer_contexts() {
  local rel_path="$1"
  local cleaned
  cleaned="$(printf '%s' "$rel_path" | tr '[:upper:]' '[:lower:]' | sed 's#^\\./##')"
  cleaned="$(printf '%s' "$cleaned" | awk -F/ '
    {
      count = 0
      for (i = 1; i <= NF; i++) {
        if ($i != "" && $i != "." && $i != "apps" && $i != "services" && $i != "packages" && $i != "libs" && $i != "src" && $i != "workspace" && $i != "projects") {
          parts[++count] = $i
        }
      }
      if (count == 0) {
        print "workspace-root"
      } else if (count == 1) {
        print parts[count]
      } else {
        print parts[count - 1] "," parts[count]
      }
    }'
  )"
  printf '%s' "$cleaned"
}

summarize_repo() {
  local repo_type="$1"
  local contexts="$2"
  local frameworks="$3"

  case "$repo_type" in
    ui) printf 'User-facing application for %s built with %s.' "\${contexts:-core workflows}" "\${frameworks:-detected frontend tooling}" ;;
    api) printf 'Service or API repository for %s using %s.' "\${contexts:-backend capabilities}" "\${frameworks:-detected backend tooling}" ;;
    worker) printf 'Background processing repository for %s.' "\${contexts:-async workflows}" ;;
    shared-lib) printf 'Shared library or common module for %s.' "\${contexts:-cross-cutting concerns}" ;;
    infra) printf 'Infrastructure-as-code repository for provisioning and environment setup.' ;;
    *) printf 'Repository discovered in the workspace for %s.' "\${contexts:-project functionality}" ;;
  esac
}

build_route() {
  local file="$1"
  local route
  route="$(printf '%s' "$file" | sed -E 's#^src/pages/##; s#^app/##; s#/page\\.(tsx|jsx|ts|js)$##; s#\\.(tsx|jsx|ts|js)$##; s#index$##; s#\\[([^]]+)\\]#:\\1#g')"
  route="/$(printf '%s' "$route" | sed 's#//*#/#g; s#/$##')"
  printf '%s' "\${route:-/}"
}

GENERATED_AT="$(timestamp_utc)"
REPO_ROOTS="$(collect_repo_roots)"

if [ -z "$REPO_ROOTS" ]; then
  REPO_ROOTS='.'
fi

TEMP_REPOS_FILE="$(mktemp)"
TEMP_SHARED_FILE="$(mktemp)"
TEMP_CONTEXT_FILE="$(mktemp)"
trap 'rm -f "$TEMP_REPOS_FILE" "$TEMP_SHARED_FILE" "$TEMP_CONTEXT_FILE"' EXIT

REPO_COUNT=0
SHARED_COUNT=0

while IFS= read -r repo_path; do
  [ -z "$repo_path" ] && continue

  if [ "$repo_path" = "$ROOT_DIR" ] || [ "$repo_path" = "." ]; then
    local_rel='.'
  else
    local_rel="\${repo_path#"$ROOT_DIR"/}"
  fi

  repo_abs="$ROOT_DIR"
  if [ "$local_rel" != "." ]; then
    repo_abs="$ROOT_DIR/$local_rel"
  fi

  repo_name="$(basename "$repo_abs")"
  repo_id="repo-$(printf '%s' "$local_rel" | tr '[:upper:]' '[:lower:]' | sed 's#^\\./##; s#[^a-z0-9]#-#g; s#--*#-#g; s#^-##; s#-$##')"
  ([ -z "$repo_id" ] || [ "$repo_id" = "repo-" ]) && repo_id="repo-workspace-root"

  files="$(list_repo_files "$repo_abs")"
  repo_type="$(detect_repo_type "$local_rel" "$files")"
  languages="$(detect_languages "$files")"
  frameworks="$(detect_frameworks "$files")"
  package_managers="$(detect_package_managers "$files")"
  contexts_csv="$(infer_contexts "$local_rel")"
  summary="$(summarize_repo "$repo_type" "\${contexts_csv//,/ /}" "$frameworks")"

  context_json=""
  IFS=',' read -r -a context_items <<< "$contexts_csv"
  for context in "\${context_items[@]}"; do
    context_trimmed="$(printf '%s' "$context" | sed 's/^ *//; s/ *$//')"
    [ -z "$context_trimmed" ] && continue
    if [ -n "$context_json" ]; then
      context_json="$context_json, "
    fi
    context_json="$context_json\"$(json_escape "$context_trimmed")\""
  done

  lang_json=""
  IFS=',' read -r -a lang_items <<< "$languages"
  for lang in "\${lang_items[@]}"; do
    lang_trimmed="$(printf '%s' "$lang" | sed 's/^ *//; s/ *$//')"
    [ -z "$lang_trimmed" ] && continue
    if [ -n "$lang_json" ]; then
      lang_json="$lang_json, "
    fi
    lang_json="$lang_json\"$(json_escape "$lang_trimmed")\""
  done

  framework_json=""
  IFS=',' read -r -a framework_items <<< "$frameworks"
  for framework in "\${framework_items[@]}"; do
    framework_trimmed="$(printf '%s' "$framework" | sed 's/^ *//; s/ *$//')"
    [ -z "$framework_trimmed" ] && continue
    if [ -n "$framework_json" ]; then
      framework_json="$framework_json, "
    fi
    framework_json="$framework_json\"$(json_escape "$framework_trimmed")\""
  done

  manager_json=""
  IFS=',' read -r -a manager_items <<< "$package_managers"
  for manager in "\${manager_items[@]}"; do
    manager_trimmed="$(printf '%s' "$manager" | sed 's/^ *//; s/ *$//')"
    [ -z "$manager_trimmed" ] && continue
    if [ -n "$manager_json" ]; then
      manager_json="$manager_json, "
    fi
    manager_json="$manager_json\"$(json_escape "$manager_trimmed")\""
  done

  key_files_json=""
  key_files_md=""
  while IFS= read -r key_file; do
    [ -z "$key_file" ] && continue
    if [ -n "$key_files_json" ]; then
      key_files_json="$key_files_json, "
      key_files_md="$key_files_md, "
    fi
    key_files_json="$key_files_json\"$(json_escape "$key_file")\""
    key_files_md="$key_files_md\`$(csv_escape "$key_file")\`"
  done <<EOF
$(printf '%s\n' "$files" | grep -Ei '(^|/)(README|routes|router|controller|package\\.json|pom\\.xml|[^/]+\\.csproj)$' | head -n 6)
EOF

  ui_screens_json=""
  while IFS= read -r screen_file; do
    [ -z "$screen_file" ] && continue
    screen_name="$(basename "$screen_file" | sed -E 's/\\.(tsx|jsx|ts|js)$//' | sed 's/[-_]/ /g')"
    screen_route="$(build_route "$screen_file")"
    if [ -n "$ui_screens_json" ]; then
      ui_screens_json="$ui_screens_json, "
    fi
    ui_screens_json="$ui_screens_json{ \"name\": \"$(json_escape "$screen_name")\", \"route\": \"$(json_escape "$screen_route")\" }"
  done <<EOF
$(printf '%s\n' "$files" | grep -Ei '(^src/pages/.*\\.(tsx|jsx|ts|js)$)|(^app/.+/page\\.(tsx|jsx|ts|js)$)' | head -n 8)
EOF

  [ "$REPO_COUNT" -gt 0 ] && printf ',\n' >> "$TEMP_REPOS_FILE"
  cat <<EOF >> "$TEMP_REPOS_FILE"
    {
      "id": "$(json_escape "$repo_id")",
      "name": "$(json_escape "$repo_name")",
      "path": "$(json_escape "$local_rel")",
      "git": {
        "root": "$(json_escape "$local_rel")",
        "branch": null,
        "remote": null
      },
      "status": "discovered",
      "repoType": "$(json_escape "$repo_type")",
      "lifecycle": "active",
      "boundedContexts": [\${context_json}],
      "ownership": {
        "team": null,
        "primary": true,
        "confidence": 0.45,
        "source": "workspace-discovery"
      },
      "tech": {
        "languages": [\${lang_json}],
        "frameworks": [\${framework_json}],
        "packageManagers": [\${manager_json}]
      },
      "capabilities": {
        "apiRoutes": [],
        "uiScreens": [\${ui_screens_json}],
        "eventsProduced": [],
        "eventsConsumed": [],
        "datastores": []
      },
      "brownfield": {
        "summary": "$(json_escape "$summary")",
        "keyFiles": [\${key_files_json}],
        "knownConstraints": []
      },
      "dependencies": {
        "internalRepos": [],
        "externalServices": []
      },
      "tags": ["$(json_escape "$repo_type")"]
    }
EOF

  if [ "$repo_type" = "shared-lib" ]; then
    [ "$SHARED_COUNT" -gt 0 ] && printf ',\n' >> "$TEMP_SHARED_FILE"
    cat <<EOF >> "$TEMP_SHARED_FILE"
    {
      "id": "$(json_escape "$repo_id")",
      "name": "$(json_escape "$repo_name")",
      "path": "$(json_escape "$local_rel")",
      "repoType": "shared-lib",
      "usedBy": [],
      "summary": "$(json_escape "$summary")"
    }
EOF
    SHARED_COUNT=$((SHARED_COUNT + 1))
  fi

  cat <<EOF >> "$TEMP_CONTEXT_FILE"
## $(csv_escape "$repo_name")

- Path: \`$(csv_escape "$local_rel")\`
- Type: \`$(csv_escape "$repo_type")\`
- Bounded contexts: $(csv_escape "\${contexts_csv//,/ , }")
- Frameworks: $(csv_escape "\${frameworks:-unknown}")
- Summary: $(csv_escape "$summary")

EOF

  REPO_COUNT=$((REPO_COUNT + 1))
done <<EOF
$REPO_ROOTS
EOF

WARNING_JSON=""
if [ "$REPO_COUNT" -le 1 ]; then
  WARNING_JSON='[
      "Only one repository was discovered. Add more repos to the workspace if the feature spans multiple services."
    ]'
else
  WARNING_JSON='[]'
fi

cat <<EOF > "$WORKSPACE_REPOS_FILE"
{
  "version": "1.0",
  "workspaceRoot": "$(json_escape "$ROOT_DIR")",
  "generatedAt": "$(json_escape "$GENERATED_AT")",
  "repos": [
$(cat "$TEMP_REPOS_FILE")
  ],
  "sharedLibraries": [
$(cat "$TEMP_SHARED_FILE")
  ],
  "discovery": {
    "toolVersion": "1.0",
    "unvalidatedRepos": [],
    "missingRepos": [],
    "warnings": $WARNING_JSON
  }
}
EOF

cat <<EOF > "$WORKSPACE_CONTEXT_FILE"
# Workspace Context

> Auto-generated from the current cloned workspace.
> Workspace root: \`$ROOT_DIR\`
> Generated: $GENERATED_AT

## Repositories ($REPO_COUNT)

$(cat "$TEMP_CONTEXT_FILE")
EOF

if [ ! -f "$REPO_PLANS_FILE" ]; then
  cat <<EOF > "$REPO_PLANS_FILE"
{
  "version": "1.0",
  "generatedAt": "$(json_escape "$GENERATED_AT")",
  "plans": []
}
EOF
fi

echo "Workspace discovery complete. Repositories found: $REPO_COUNT"
echo "Updated specs/.devx/workspace-repos.json and workspace-context.md"
`;
}
