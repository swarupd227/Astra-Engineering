import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string; // artifact organization id
  organizationName?: string;
  organizationUrl?: string; // full org URL (https://dev.azure.com/ORG/)
}

const TEMPLATE_MAP: { label: string; id: string }[] = [
  { label: "Agile", id: "adcc42ab-9882-485e-a3ed-7678f01f66bc" },
  { label: "Scrum", id: "6b724908-ef14-45cf-84f8-768b5384da45" },
  { label: "CMMI", id: "27450541-8e31-4150-9947-dc59f998fc01" },
];

export function CreateADOProjectDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  organizationUrl,
}: Props) {
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState(TEMPLATE_MAP[0].id);
  const [sourceControl, setSourceControl] = useState("Git");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProjectName(organizationName ? `${organizationName}-project` : "");
      setDescription("");
      setTemplateId(TEMPLATE_MAP[0].id);
      setSourceControl("Git");
      setErrorMsg(null);
    }
  }, [open, organizationName]);

  const mutation = useMutation({
    mutationFn: async (body: any) => {
      return apiRequest("POST", "/api/create-project", body);
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
      toast({
        title: "ADO Project created",
        description: "Project created successfully in Azure DevOps",
      });
      onOpenChange(false);
    },
    onError: (err: any) => {
      const m = err instanceof Error ? err.message : JSON.stringify(err);
      setErrorMsg(m);
      toast({
        title: "Failed to create ADO project",
        description: m,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    setErrorMsg(null);
    if (!projectName.trim()) {
      setErrorMsg("Project name is required");
      return;
    }
    if (!organizationId) {
      setErrorMsg("Organization selection is required");
      return;
    }

    const body = {
      projectName: projectName.trim(),
      projectDescription: description.trim() || null,
      // send the organization URL so server can reliably extract the organization name
      organization: organizationUrl || organizationName || null,
      organizationId,
      cloudProvider: "Azure DevOps",
      templateTypeId: templateId,
      sourceControlType: sourceControl,
    };

    mutation.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Azure DevOps Project</DialogTitle>
          <DialogDescription>
            Create a new project in the selected Azure DevOps organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {errorMsg && (
            <Alert variant="destructive">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Project Name *</Label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Process Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_MAP.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Source Control</Label>
              <Select value={sourceControl} onValueChange={setSourceControl}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Git">Git</SelectItem>
                  <SelectItem value="TFVC">TFVC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
