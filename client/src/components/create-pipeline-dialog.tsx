import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  GitBranch,
  Database,
  FileCode,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { InfraBootstrapOption, PipelineCreationMode } from "@shared/pipeline-automation";

interface CreatePipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  organization?: string;
  projectName?: string;
}

export function CreatePipelineDialog({
  open,
  onOpenChange,
  projectId,
  organization,
  projectName,
}: CreatePipelineDialogProps) {
  const { toast } = useToast();
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [selectedRepoName, setSelectedRepoName] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [pipelineName, setPipelineName] = useState<string>("");
  const [yamlPath, setYamlPath] = useState<string>("azure-pipelines.yml");
  const [mode, setMode] = useState<PipelineCreationMode>("yamlRepoMode");
  const [templateId, setTemplateId] = useState<string>("");
  const [secretKeysText, setSecretKeysText] = useState<string>("");
  const [infraOption, setInfraOption] = useState<InfraBootstrapOption>("none");
  const [saveAsTemplate, setSaveAsTemplate] = useState<boolean>(false);
  const [templateName, setTemplateName] = useState<string>("");
  const [createdPipeline, setCreatedPipeline] = useState<any>(null);

  const queryParams = new URLSearchParams();
  if (organization) queryParams.set("organization", organization);
  if (projectName) queryParams.set("projectName", projectName);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";

  // Fetch repositories — API returns array directly (not { value: [] })
  const { data: reposData, isLoading: reposLoading } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/repositories`, organization, projectName],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/repositories${qs}`).then(
        (r) => r.json()
      ),
    enabled: open && !!projectId,
    staleTime: 60_000,
  });

  // Fetch branches for selected repo (uses build-branches route that doesn't require SDLC project)
  const { data: branchesData, isLoading: branchesLoading, isError: branchesError } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/ado/build-branches/${selectedRepoId}`,
      organization,
      projectName,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/sdlc/projects/${projectId}/ado/build-branches/${selectedRepoId}${qs}`
      ).then((r) => r.json()),
    enabled: open && !!selectedRepoId,
    staleTime: 60_000,
    retry: 1,
  });

  const { data: templatesData, isLoading: templatesLoading } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/pipeline-templates`, organization, projectName],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/pipeline-templates${qs}`).then((r) =>
        r.json().then((d) => d?.value || [])
      ),
    enabled: open && !!projectId,
    staleTime: 60_000,
  });

  // Create pipeline mutation
  const createPipelineMutation = useMutation({
    mutationFn: async () => {
      const secretKeys = secretKeysText
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      const payload: Record<string, any> = {
        mode,
        organization,
        projectName,
        infraBootstrapOption: infraOption,
        variableInputs: {},
        secretKeys,
        pipelineName,
      };

      if (mode === "templateMode") {
        payload.templateId = templateId;
      } else {
        payload.repoId = selectedRepoId;
        payload.repoName = selectedRepoName;
        payload.branchName = selectedBranch;
        payload.yamlPath = yamlPath || "azure-pipelines.yml";
      }

      if (saveAsTemplate && templateName.trim()) {
        payload.saveAsTemplate = true;
        payload.saveTemplatePayload = {
          name: templateName.trim(),
          description: `Saved from ${pipelineName}`,
          tags: ["ado", "pipeline"],
          scope: "project",
          spec: {
            baseMode: mode === "templateMode" ? "yamlRepoMode" : mode,
            defaultPipelineName: pipelineName,
            yamlPath: yamlPath || "azure-pipelines.yml",
            repoStrategy: "optional",
            branchStrategy: "optional",
            variableSchema: [],
            secretRefs: secretKeys,
          },
        };
      }

      const res = await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/ado/pipeline-automation/orchestrate`,
        payload
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create pipeline");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedPipeline(data?.pipeline || data);
      toast({
        title: "Pipeline Created",
        description: `Pipeline "${data?.pipeline?.name || data?.name || pipelineName}" has been created successfully.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to Create Pipeline",
        description: err.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleRepoChange = (repoId: string) => {
    const repo = (Array.isArray(reposData) ? reposData : []).find((r: any) => r.id === repoId);
    setSelectedRepoId(repoId);
    setSelectedRepoName(repo?.name || "");
    setSelectedBranch("");
    // Pre-fill pipeline name with repo name if empty
    if (!pipelineName && repo?.name) {
      setPipelineName(`${repo.name}-pipeline`);
    }
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setSelectedRepoId("");
      setSelectedRepoName("");
      setSelectedBranch("");
      setPipelineName("");
      setYamlPath("azure-pipelines.yml");
      setMode("yamlRepoMode");
      setTemplateId("");
      setSecretKeysText("");
      setInfraOption("none");
      setSaveAsTemplate(false);
      setTemplateName("");
      setCreatedPipeline(null);
    }
    onOpenChange(val);
  };

  const canCreate =
    mode === "templateMode"
      ? !!templateId && !!pipelineName.trim()
      : !!selectedRepoId && !!selectedBranch && !!pipelineName.trim() && !!yamlPath.trim();

  const createdProjectName = createdPipeline?.project?.name || projectName;
  const createdPipelineUrl =
    createdPipeline && organization && createdProjectName
      ? `https://dev.azure.com/${organization}/${createdProjectName}/_build/definition?definitionId=${createdPipeline.id}`
      : createdPipeline?._links?.web?.href;
  const allPipelinesUrl =
    organization && createdProjectName
      ? `https://dev.azure.com/${organization}/${createdProjectName}/_build?view=folders`
      : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-500" />
            Create Pipeline
          </DialogTitle>
          <DialogDescription>
            Create with mode-driven ADO orchestration and optional template save.
          </DialogDescription>
        </DialogHeader>

        {createdPipeline ? (
          /* Success state */
          <div className="py-6 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <div>
              <div className="font-semibold text-base">Pipeline Created Successfully</div>
              <div className="text-sm text-muted-foreground mt-1">
                Pipeline <span className="font-medium">"{createdPipeline.name}"</span>{" "}
                (ID: {createdPipeline.id}) has been created.
              </div>
            </div>
            <div className="w-full text-left text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 space-y-1">
              <div className="font-semibold text-amber-800 dark:text-amber-400">Where to find it in Azure DevOps</div>
              <div className="text-amber-700 dark:text-amber-500">
                Go to <span className="font-medium">Pipelines &rarr; Pipelines</span> and click the{" "}
                <span className="font-medium">"All"</span> tab — newly created pipelines only appear under "All", not "Recent".
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">ID: {createdPipeline.id}</Badge>
              {createdPipelineUrl && (
                <a
                  href={createdPipelineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Pipeline
                </a>
              )}
              {allPipelinesUrl && (
                <a
                  href={allPipelinesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  All Pipelines
                </a>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatedPipeline(null);
                setSelectedRepoId("");
                setSelectedBranch("");
                setPipelineName("");
                setYamlPath("azure-pipelines.yml");
              }}
            >
              Create Another Pipeline
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Creation Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as PipelineCreationMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yamlRepoMode">YAML from Repo</SelectItem>
                  <SelectItem value="yamlGeneratedMode">Generated YAML</SelectItem>
                  <SelectItem value="templateMode">From Template</SelectItem>
                  <SelectItem value="cloneDefinitionMode">Clone Definition (beta)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "templateMode" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Template</Label>
                {templatesLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(Array.isArray(templatesData) ? templatesData : []).map((tpl: any) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name} (v{tpl.latestVersion})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Repository */}
            {mode !== "templateMode" && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                Repository
              </Label>
              {reposLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedRepoId} onValueChange={handleRepoChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(reposData) ? reposData : []).map((repo: any) => (
                      <SelectItem key={repo.id} value={repo.id}>
                        {repo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            )}

            {/* Branch */}
            {mode !== "templateMode" && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                Branch
              </Label>
              {!selectedRepoId ? (
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository first" />
                  </SelectTrigger>
                </Select>
              ) : branchesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : branchesError ? (
                <div className="text-xs text-destructive p-2 border border-destructive/30 rounded-md bg-destructive/10">
                  Failed to load branches. Check your ADO configuration.
                </div>
              ) : (
                <Select
                  key={selectedRepoId}
                  value={selectedBranch || undefined}
                  onValueChange={(val) => setSelectedBranch(val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(branchesData) ? branchesData : []).map(
                      (branch: any) => {
                        const name = branch.name || "";
                        return (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        );
                      }
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
            )}

            {/* Pipeline Name */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm" htmlFor="pipeline-name">
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                Pipeline Name
              </Label>
              <Input
                id="pipeline-name"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="e.g. my-app-pipeline"
              />
            </div>

            {/* YAML Path */}
            {mode !== "templateMode" && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm" htmlFor="yaml-path">
                <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                YAML File Path
              </Label>
              <Input
                id="yaml-path"
                value={yamlPath}
                onChange={(e) => setYamlPath(e.target.value)}
                placeholder="azure-pipelines.yml"
              />
              <p className="text-xs text-muted-foreground">
                Path to the pipeline YAML file in the repository (e.g.{" "}
                <code className="text-xs">azure-pipelines.yml</code>)
              </p>
            </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Secret References (comma-separated keys)</Label>
              <Input
                value={secretKeysText}
                onChange={(e) => setSecretKeysText(e.target.value)}
                placeholder="ADO_PAT, SWA_TOKEN"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Infra Bootstrap</Label>
              <Select value={infraOption} onValueChange={(v) => setInfraOption(v as InfraBootstrapOption)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="resourceGroupOnly">Resource Group only</SelectItem>
                  <SelectItem value="appServiceBootstrap">App Service bootstrap</SelectItem>
                  <SelectItem value="swaBootstrap">Static Web App bootstrap</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="save-template"
                  checked={saveAsTemplate}
                  onCheckedChange={(checked) => setSaveAsTemplate(!!checked)}
                />
                <Label htmlFor="save-template" className="text-sm cursor-pointer">
                  Save as reusable template
                </Label>
              </div>
              {saveAsTemplate && (
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canCreate || createPipelineMutation.isPending}
                onClick={() => createPipelineMutation.mutate()}
              >
                {createPipelineMutation.isPending ? (
                  <>Creating…</>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Create Pipeline
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
