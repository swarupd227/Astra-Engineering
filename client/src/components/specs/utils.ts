import type { FeatureNode, UserStoryNode } from "./types";

export const SPECS_JOB_STORAGE_PREFIX = "sdlc_specs_job_";

export type SpecsGitProviderKey =
  | "gitlab"
  | "github"
  | "bitbucket"
  | "azure_repos"
  | "github-tenant"
  | null;

export function getSpecsGitProviderLabel(
  providerKey: SpecsGitProviderKey | string | undefined,
): string {
  switch (providerKey) {
    case "gitlab":
      return "GitLab";
    case "github":
    case "github-tenant":
      return "GitHub";
    case "bitbucket":
      return "Bitbucket";
    case "azure_repos":
      return "Azure DevOps";
    default:
      return "Git";
  }
}

export function persistSpecsJob(projectId: string, jobId: string) {
  if (typeof window === "undefined") return;
  try {
    const key = `${SPECS_JOB_STORAGE_PREFIX}${projectId}`;
    const payload = {
      jobId,
      projectId,
      startedAt: Date.now(),
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function loadSpecsJob(projectId: string): { jobId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const key = `${SPECS_JOB_STORAGE_PREFIX}${projectId}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.jobId === "string") {
      return { jobId: data.jobId };
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearSpecsJob(projectId: string) {
  if (typeof window === "undefined") return;
  try {
    const key = `${SPECS_JOB_STORAGE_PREFIX}${projectId}`;
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function sanitizeSlug(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "feature";
}

export function generateSpecsMarkdown(
  feature: FeatureNode,
  stories: UserStoryNode[],
): string {
  const featureTitle = feature.title || `Feature ${feature.id}`;

  const storiesList =
    stories.length > 0
      ? stories
          .map(
            (s) =>
              `- **US ${s.id} — ${s.title}**${
                s.storyPoints != null ? ` \`(${s.storyPoints} pts)\`` : ""
              }`,
          )
          .join("\n")
      : "- _No user stories selected for this feature yet._";

  const acceptanceBullets =
    stories.length > 0
      ? stories
          .map((s) => {
            const criteria =
              s.acceptanceCriteria &&
              String(s.acceptanceCriteria).trim().length > 0
                ? String(s.acceptanceCriteria).trim()
                : "Acceptance criteria to be defined.";
            return `- **US ${s.id} — ${s.title}**\n  - ${criteria.replace(/\r?\n/g, "\n  ")}`;
          })
          .join("\n")
      : "- Define acceptance criteria for each user story.";

  const today = new Date().toISOString().slice(0, 10);

  return `# Feature: ${featureTitle}
Status: NEW
Owner: DevX
Last Updated: ${today}

## Summary
Describe the business value and scope for **${featureTitle}**.

This feature is implemented through the following user stories:

${storiesList}

## Goals
- Capture the intended outcome and success metrics for this feature.
- Align all user stories with the same business objective.

## User Stories Covered

${storiesList}

## Functional Requirements (testable)

For each user story, list concrete, testable behaviours:

${acceptanceBullets}

## Non-functional Requirements
- Performance, security, accessibility, and reliability constraints that apply to this feature.

## Assumptions
- Document any assumptions made while defining ${featureTitle}.

## Open Questions
- Capture questions that need clarification before build.
`;
}

export function generateRequirementsChecklistMarkdown(
  feature: FeatureNode,
  stories: UserStoryNode[],
): string {
  const featureTitle = feature.title || `Feature ${feature.id}`;
  const storiesLine =
    stories.length > 0
      ? stories.map((s) => `US ${s.id}: ${s.title}`).join("; ")
      : "No user stories selected yet.";

  return `# Specification Quality Checklist: ${featureTitle}

**Purpose**: Validate specification completeness and quality before proceeding to planning.
**Created**: ${new Date().toISOString().slice(0, 10)}
**Feature**: ${featureTitle}
**User Stories Considered**: ${storiesLine}

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Success criteria are technology-agnostic (no implementation details)
- [ ] All acceptance scenarios are defined
- [ ] Edge cases are identified
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before build or testing activities.
`;
}
