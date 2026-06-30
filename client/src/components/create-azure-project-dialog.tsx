import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Organization {
  id: string;
  projectName: string;
  organizationUrl: string;
}

interface CreateAzureProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization | null;
}

const processTemplates = [
  {
    label: "Agile",
    value: "adcc42ab-9882-485e-a3ed-7678f01f66bc",
  },
  {
    label: "Scrum",
    value: "6b724908-ef14-45cf-84f8-768b5384da45",
  },
  {
    label: "CMMI",
    value: "27450541-8e31-4150-9947-dc59f998fc01",
  },
];

const sourceControlOptions = [
  { label: "Git", value: "Git" },
  { label: "TFVC", value: "Tfvc" },
];

export function CreateAzureProjectDialog({
  open,
  onOpenChange,
  organization,
}: CreateAzureProjectDialogProps) {
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [templateTypeId, setTemplateTypeId] = useState(processTemplates[0].value);
  const [sourceControlType, setSourceControlType] = useState("Git");
  const [formError, setFormError] = useState<string | null>(null);

  const organizationLabel = useMemo(() => {
    if (!organization) return "";
    return (
      organization.projectName ||
      organization.organizationUrl
        .replace(/^https?:\/\/dev\.azure\.com\//i, "")
        .replace(/\/$/, "")
    );
  }, [organization]);

  const resetForm = () => {
    setProjectName("");
    setDescription("");
    setTemplateTypeId(processTemplates[0].value);
    setSourceControlType("Git");
    setFormError(null);
  };

  const createAzureProjectMutation = useMutation({
    mutationFn: async () => {
      if (!organization || !organization.id) {
        throw new Error("Please select an organization before creating a project.");
      }

      if (!projectName.trim()) {
        throw new Error("Project name is required.");
      }

      const payload = {
        organizationId: organization.id,
        projectName: projectName.trim(),
        projectDescription: description.trim() || null,
        templateTypeId,
        sourceControlType,
      };

      return apiRequest("POST", "/api/create-azure-ado-project", payload);
    },
    onSuccess: (response) => {
      toast({
        title: "Successfully created record in Azure DevOps",
        description: `Azure DevOps project "${response?.name || projectName}" created successfully.`,
      });
      resetForm();
      onOpenChange(false);

      // Refresh ADO projects list
      if (organization?.id) {
        queryClient.invalidateQueries({
          queryKey: [`/api/ado-projects?org=${organization.id}`],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects?org=all"] });
      // Also invalidate general query key so SDLC nav refreshes automatically
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
    },
    onError: (error: any) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : error?.error || "Failed to create Azure DevOps project";
      setFormError(errorMessage);
      toast({
        title: "Failed to create Azure DevOps project",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    setFormError(null);
    createAzureProjectMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val) {
        resetForm();
      }
      onOpenChange(val);
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Azure DevOps Project</DialogTitle>
          <DialogDescription>
            Provision a new Azure DevOps project inside{" "}
            <span className="font-medium">{organizationLabel || "the selected organization"}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!organization && (
            <Alert variant="destructive">
              <AlertDescription>
                Please select an organization from the dropdown before creating an Azure DevOps project.
              </AlertDescription>
            </Alert>
          )}

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="ado-project-name">Project Name *</Label>
            <Input
              id="ado-project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ado-project-description">Description</Label>
            <Textarea
              id="ado-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter project description (optional)"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Process Template</Label>
              <Select
                value={templateTypeId}
                onValueChange={setTemplateTypeId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {processTemplates.map((template) => (
                    <SelectItem key={template.value} value={template.value}>
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Source Control Type</Label>
              <Select
                value={sourceControlType}
                onValueChange={setSourceControlType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceControlOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!organization || createAzureProjectMutation.isPending}
              onClick={handleSubmit}
            >
              {createAzureProjectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

