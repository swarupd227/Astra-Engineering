import { CheckCircle2, ArrowUpFromLine, ArrowDownToLine, AlertTriangle, Plus, Cloud } from "lucide-react";

export interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
  integrationType?: "ado" | "jira";
}

export interface BacklogContextResponse {
  artifactsByState: Record<
    string,
    {
      epics: any[];
      features: any[];
      userStories: any[];
    }
  >;
}

export interface DevelopmentSpecsModalProps {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  onClose: () => void;
  integrationType?: string;
}

export interface EpicNode {
  id: number;
  title: string;
  state: string;
  description?: string;
  workItemUrl?: string;
  childFeatureIds: number[];
}

export interface FeatureNode {
  id: number;
  title: string;
  state: string;
  description?: string;
  workItemUrl?: string;
  userStories: UserStoryNode[];
  parentEpicId?: number;
}

export interface UserStoryNode {
  id: number;
  title: string;
  state: string;
  description?: string;
  acceptanceCriteria?: string;
  storyPoints?: number | null;
  workItemUrl?: string;
}

export type GeneratedFileType = "specs" | "requirements" | "tdd-tests" | "devx-context" | "prompt";

export type SpecsArchitectureStyle = "monolith" | "microservices";
export type SpecsDeliveryOrder = "ui-first" | "api-first";

export interface GeneratedFile {
  id: string;
  featureId: number;
  featureTitle: string;
  type: GeneratedFileType;
  fileName: string;
  path: string;
  content: string;
  pushedToAdo?: boolean;
  pushedToAdoAt?: string | null;
}

export type SyncStatusType =
  | "in-sync"
  | "modified-locally"
  | "modified-in-repo"
  | "conflict"
  | "local-only"
  | "repo-only";

export interface SyncFileStatus {
  path: string;
  status: SyncStatusType;
  localFileId?: string;
  repoObjectId?: string;
  featureId?: number;
  featureTitle?: string;
  fileName?: string;
  fileType?: string;
}

export interface ValidationIssue {
  featureId?: number;
  featureTitle?: string;
  type: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  idempotentFeatures: number[];
  autoAdded: { id: number; title: string; reason: string }[];
}

export interface ProjectGitConfig {
  id: string;
  projectId: string;
  provider: "github" | "ado";
  branch: string;
  basePath?: string | null;
  adoRepositoryId?: string | null;
  adoRepositoryName?: string | null;
  token?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const syncStatusConfig: Record<
  SyncStatusType,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  "in-sync": { icon: CheckCircle2, color: "text-green-500", label: "In sync" },
  "modified-locally": { icon: ArrowUpFromLine, color: "text-blue-500", label: "Modified locally" },
  "modified-in-repo": { icon: ArrowDownToLine, color: "text-orange-500", label: "Modified in repo" },
  conflict: { icon: AlertTriangle, color: "text-red-500", label: "Conflict" },
  "local-only": { icon: Plus, color: "text-emerald-500", label: "New (not pushed)" },
  "repo-only": { icon: Cloud, color: "text-purple-500", label: "Repo only" },
};
