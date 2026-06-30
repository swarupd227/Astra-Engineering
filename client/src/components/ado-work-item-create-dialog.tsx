import { AdoWorkItemDialog } from "./ado-work-item-dialog";

interface AdoWorkItemCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  artifactOrgId?: string;
  organizationUrl?: string;
  projectId?: string;
  organization?: string;
  integrationType?: "ado" | "jira";
  /**
   * For Jira projects: the actual issue types available in the project.
   * When provided the work-item-type dropdown will be limited to these
   * (subtasks excluded). Falls back to the hardcoded ADO list when omitted.
   */
  availableIssueTypes?: Array<{
    id: string;
    name: string;
    subtask?: boolean;
  }>;
  initialWorkItemType?: string;
}

export function AdoWorkItemCreateDialog({
  open,
  onOpenChange,
  projectName,
  artifactOrgId,
  organizationUrl,
  projectId,
  organization,
  integrationType,
  availableIssueTypes,
  initialWorkItemType = "User Story",
}: AdoWorkItemCreateDialogProps) {
  return (
    <AdoWorkItemDialog
      mode="create"
      open={open}
      onOpenChange={onOpenChange}
      projectName={projectName}
      artifactOrgId={artifactOrgId}
      organizationUrl={organizationUrl}
      projectId={projectId}
      organization={organization}
      integrationType={integrationType}
      availableIssueTypes={availableIssueTypes}
      initialWorkItemType={initialWorkItemType}
    />
  );
}
