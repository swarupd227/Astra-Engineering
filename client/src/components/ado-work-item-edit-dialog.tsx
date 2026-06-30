import { AdoWorkItemDialog, type DetailedWorkItem } from "./ado-work-item-dialog";

interface AdoWorkItemEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItem?: DetailedWorkItem | null;
  workItemId?: string | null;
  projectName: string;
  artifactOrgId?: string;
  organizationUrl?: string;
  projectId?: string;
  integrationType?: "ado" | "jira";
}

export function AdoWorkItemEditDialog({
  open,
  onOpenChange,
  workItem,
  workItemId,
  projectName,
  artifactOrgId,
  organizationUrl,
  projectId,
  integrationType,
}: AdoWorkItemEditDialogProps) {
  return (
    <AdoWorkItemDialog
      mode="edit"
      open={open}
      onOpenChange={onOpenChange}
      projectName={projectName}
      artifactOrgId={artifactOrgId}
      organizationUrl={organizationUrl}
      projectId={projectId}
      integrationType={integrationType}
      workItem={workItem}
      workItemId={workItemId}
    />
  );
}
