import { useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: {
    id: string;
    name: string;
    description: string;
    organization: string;
    organizationUrl: string;
    integrationType?: string;
  };
  onProjectDeleted: () => void;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  onProjectDeleted,
}: DeleteProjectDialogProps) {
  const [confirmName, setConfirmName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const { toast } = useToast();

  const isJira = project.integrationType === "jira";
  const platformName = isJira ? "Jira" : "Azure DevOps";

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setConfirmName("");
      setConfirmStep(false);
    }
  }, [open]);

  const isConfirmValid = confirmName === project.name;
  const canDelete = isConfirmValid && !isLoading;

  const handleDelete = async () => {
    if (!canDelete) {
      return;
    }

    // Double confirmation without browser alerts:
    // First click arms confirmation, second click executes.
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("DELETE", `/api/ado-projects/${project.id}`, {
        organization: project.organization,
        organizationUrl: project.organizationUrl,
        // For ADO this means deleteFromAdo, for Jira it means deleteFromJira
        deleteFromAdo: true,
      });

      toast({
        title: "Success",
        description:
          `Project deleted from ${platformName} and marked deleted in Astra`,
      });

      onProjectDeleted();
      onOpenChange(false);
    } catch (error) {
      console.error("Error deleting project:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete project",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Project"
      description={`This will delete the ${platformName} project and mark it as deleted in Astra. Please confirm by typing the project name.`}
      icon={AlertTriangle}
      width="500px"
      contentClassName="space-y-4"
      footerButtons={[
        {
          label: "Cancel",
          onClick: () => onOpenChange(false),
          variant: "outline",
          disabled: isLoading,
        },
        {
          label: isLoading
            ? "Deleting..."
            : confirmStep
            ? "Confirm Delete"
            : "Delete Project",
          onClick: handleDelete,
          variant: "destructive",
          disabled: !canDelete,
          loading: isLoading,
        },
      ]}
    >
      <Alert variant="destructive" className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <AlertDescription className="flex-1">
          <div className="space-y-1">
            <p>You are about to delete the project <strong>{project.name}</strong>.</p>
            <p>This action is permanent.</p>
          </div>
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="confirm-name">
          Type <strong>{project.name}</strong> to confirm deletion
        </Label>
        <Input
          id="confirm-name"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={project.name}
          disabled={isLoading}
          className={confirmName && !isConfirmValid ? "border-destructive" : ""}
        />
        {confirmName && !isConfirmValid && (
          <p className="text-sm text-destructive">
            Project name does not match
          </p>
        )}
      </div>

      <Alert className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <AlertDescription className="flex-1">
          <div className="space-y-1">
            <p><strong>Warning:</strong> This will delete the project and all its data from {platformName}.</p>
            {isJira ? (
              <p>Site Administrator permissions in Jira may be required.</p>
            ) : (
              <p>"Project Collection Administrator" permissions are required.</p>
            )}
            <p>The project will remain in Astra but marked as deleted.</p>
          </div>
        </AlertDescription>
      </Alert>

      {confirmStep && (
        <p className="text-xs text-destructive text-right mt-2">
          {`Click "Confirm Delete" to remove from ${platformName} and mark deleted in Astra.`}
        </p>
      )}
    </GenericModal>
  );
}
