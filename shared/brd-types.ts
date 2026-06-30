/**
 * Shared types for BRD generation API and compliance guidance.
 * Compliance guidance is sourced from sdlc_projects.golden_repo_reference (server-side).
 */

/** Normalized guideline item used by the BRD/RAG generator (name + content). */
export type ComplianceGuidelineItem = {
  name: string;
  content: string;
};

/** Request shape for POST /api/brd/generate. Compliance guidance is derived server-side from projectId. */
export type BRDGenerateRequest = {
  projectId?: string;
  projectName: string;
  projectDescription: string;
  businessObjectives?: string;
  targetAudience?: string;
  keyFeatures?: string;
  constraints?: string;
  successCriteria?: string;
  timeline?: string;
  budget?: string;
  stakeholders?: string;
  existingRequirements?: string;
  brdId?: string;
  generationDate?: string;
  /** @deprecated Ignored by server. Guidance is read from sdlc_projects.golden_repo_reference by projectId. */
  goldenRepoSelections?: unknown;
};
