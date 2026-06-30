export interface ArtifactOrganization {
  id: string;
  projectName: string;
  organizationUrl: string;
}

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrganizationId?: string | null;
  selectedOrganization?: ArtifactOrganization | null;
  onProjectCreated?: (organizationId?: string | null) => void;
  goldenRepoId?: string | null;
  goldenRepoName?: string | null;
}

export interface CatalogToolItem {
  id: string;
  categoryKey: string;
  providerKey: string;
  displayName: string;
  supportsTesting?: number;
  requiredFields: Array<{ key: string; label: string; type: "text" | "password" | "url" | "email"; required: boolean }>;
}

export type TestStatus = "idle" | "testing" | "success" | "error";

export interface ToolConfigState {
  providerId: string;
  values: Record<string, string>;
}

export interface OrgIntegrationConfigRow {
  id: string;
  orgType: string;
  orgId: string;
  categoryKey: string;
  providerKey: string;
  displayName: string;
  toolCatalogId: string;
  supportsTesting: number;
  configDisplay: Record<string, string>;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
}
