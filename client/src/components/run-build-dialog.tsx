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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  Rocket,
  GitBranch,
  Database,
  Play,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ProviderSegment = "ado" | "gitlab" | "github" | "bitbucket";

interface RunBuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  organization?: string;
  projectName?: string;
  providerSegment?: ProviderSegment;
}

function getProviderLabel(seg: ProviderSegment): string {
  if (seg === "gitlab") return "GitLab";
  if (seg === "github") return "GitHub Actions";
  if (seg === "bitbucket") return "Bitbucket Pipelines";
  return "Azure DevOps";
}

function getPipelineLabel(seg: ProviderSegment): string {
  if (seg === "github") return "Workflow";
  if (seg === "bitbucket") return "Pipeline";
  if (seg === "gitlab") return "Pipeline";
  return "Pipeline";
}

function getGitProviderErrorMessage(error: unknown, fallback: string): string {
  const raw = error as any;
  const maybeJson =
    raw?.gitlabContext || raw?.error
      ? raw
      : typeof raw?.message === "string"
        ? (() => {
            try {
              return JSON.parse(raw.message);
            } catch {
              return null;
            }
          })()
        : null;
  const context = maybeJson?.gitlabContext;
  if (context?.projectRef) {
    return `${maybeJson?.error || fallback} (${context.source || "git"} project ${context.projectRef} at ${context.baseUrl || "GitLab"}).`;
  }
  return maybeJson?.error || raw?.message || fallback;
}

export function RunBuildDialog({
  open,
  onOpenChange,
  projectId,
  organization,
  projectName,
  providerSegment,
}: RunBuildDialogProps) {
  const { toast } = useToast();
  const hasProvider = !!providerSegment;
  const isAdo = providerSegment === "ado";
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [selectedRepoName, setSelectedRepoName] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedPipelineName, setSelectedPipelineName] = useState<string>("");
  const [queuedBuild, setQueuedBuild] = useState<any>(null);

  const adoParams = new URLSearchParams();
  if (organization) adoParams.set("organization", organization);
  if (projectName) adoParams.set("projectName", projectName);
  const adoQs = adoParams.toString() ? `?${adoParams.toString()}` : "";

  const providerLabel = providerSegment ? getProviderLabel(providerSegment) : "CI/CD provider";
  const pipelineLabel = providerSegment ? getPipelineLabel(providerSegment) : "Pipeline";

  // ── ADO: repositories ──────────────────────────────────────────
  const { data: reposData, isLoading: reposLoading } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/repositories`, organization, projectName],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/repositories${adoQs}`).then(
        (r) => r.json()
      ),
    enabled: open && !!projectId && isAdo,
    staleTime: 60_000,
  });

  // ── ADO: branches per selected repo ───────────────────────────
  const { data: adoBranchesData, isLoading: adoBranchesLoading, isError: adoBranchesError } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/build-branches/${selectedRepoId}`, organization, projectName],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/build-branches/${selectedRepoId}${adoQs}`).then(
        (r) => r.json()
      ),
    enabled: open && !!selectedRepoId && isAdo,
    staleTime: 60_000,
    retry: 1,
  });

  // ── ADO: pipelines ─────────────────────────────────────────────
  const { data: adoPipelinesData, isLoading: adoPipelinesLoading } = useQuery<{ value: any[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/pipelines`, organization, projectName],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/pipelines${adoQs}`).then(
        (r) => r.json()
      ),
    enabled: open && !!selectedRepoId && isAdo,
    staleTime: 60_000,
  });
  const adoFilteredPipelines = (adoPipelinesData?.value || []).filter((p: any) => {
    const repoId = p.repository?.id;
    return !selectedRepoId || !repoId || repoId === selectedRepoId;
  });

  // ── External provider: branches ────────────────────────────────
  const {
    data: extBranchesRaw,
    isLoading: extBranchesLoading,
    isError: extBranchesError,
    error: extBranchesQueryError,
  } = useQuery<any>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/branches`],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/${providerSegment}/branches`).then(
        (r) => r.json()
      ),
    enabled: open && !!projectId && hasProvider && !isAdo,
    staleTime: 60_000,
    retry: 1,
  });
  // Normalise: gitlab → array of {name}, github → {value:[{name}]}, bitbucket → {value:[{name}]}
  const extBranches: Array<{ name: string }> = (() => {
    if (!extBranchesRaw) return [];
    if (Array.isArray(extBranchesRaw)) return extBranchesRaw;
    if (Array.isArray(extBranchesRaw.value)) return extBranchesRaw.value;
    return [];
  })();

  // ── External provider: pipelines / workflows ───────────────────
  const {
    data: extPipelinesRaw,
    isLoading: extPipelinesLoading,
    isError: extPipelinesError,
    error: extPipelinesQueryError,
  } = useQuery<any>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/pipelines`],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/${providerSegment}/pipelines`).then(
        (r) => r.json()
      ),
    enabled: open && !!projectId && hasProvider && !isAdo,
    staleTime: 60_000,
  });
  const extPipelines: Array<{ id: string | number; name: string }> = (() => {
    const raw = extPipelinesRaw?.value || extPipelinesRaw;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p: any) => p.entryKind !== "placeholder" && Number(p.id || 0) > 0)
      .map((p: any) => ({ id: String(p.id), name: String(p.name || p.path || `#${p.id}`) }));
  })();

  // ── Combined loading/error state ───────────────────────────────
  const branchesLoading = isAdo ? adoBranchesLoading : extBranchesLoading;
  const branchesError = isAdo ? adoBranchesError : extBranchesError;
  const branchesErrorMessage =
    !isAdo && extBranchesError
      ? getGitProviderErrorMessage(
          extBranchesQueryError,
          `Failed to load branches. Ensure ${providerLabel} is configured for this project in Settings.`
        )
      : `Failed to load branches. Ensure ${providerLabel} is configured for this project in Settings.`;
  const branches: Array<{ name: string }> = isAdo
    ? Array.isArray(adoBranchesData) ? adoBranchesData : []
    : extBranches;
  const pipelinesLoading = isAdo ? adoPipelinesLoading : extPipelinesLoading;
  const pipelinesError = !isAdo && extPipelinesError;
  const pipelinesErrorMessage = getGitProviderErrorMessage(
    extPipelinesQueryError,
    `Failed to load ${pipelineLabel.toLowerCase()}s.`
  );
  const pipelines = isAdo ? adoFilteredPipelines : extPipelines;

  // ── Queue build mutation ───────────────────────────────────────
  const queueBuildMutation = useMutation({
    mutationFn: async () => {
      if (!providerSegment) {
        throw new Error("Configure a CI/CD provider before running a build.");
      }
      if (isAdo) {
        const res = await apiRequest(
          "POST",
          `/api/sdlc/projects/${projectId}/ado/queue-build`,
          { pipelineId: Number(selectedPipelineId), branchName: selectedBranch, organization, projectName }
        );
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed to queue build"); }
        return res.json();
      }
      const body: Record<string, unknown> = {
        branchName: selectedBranch,
        pipelineRunId: selectedPipelineId ? Number(selectedPipelineId) : undefined,
      };
      if (providerSegment === "bitbucket" && selectedPipelineName) {
        body.pipelineName = selectedPipelineName;
      }
      const res = await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/${providerSegment}/queue-build`,
        body
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `Failed to trigger ${providerLabel} build`); }
      return res.json();
    },
    onSuccess: (data) => {
      setQueuedBuild(data);
      toast({
        title: "Build Triggered",
        description: `Build #${data.buildNumber || data.id} has been queued in ${providerLabel}.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to Trigger Build",
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
    setSelectedPipelineId("");
    setSelectedPipelineName("");
  };

  const handlePipelineChange = (id: string) => {
    setSelectedPipelineId(id);
    const found = pipelines.find((p) => String(p.id) === id);
    setSelectedPipelineName(found?.name || "");
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setSelectedRepoId("");
      setSelectedRepoName("");
      setSelectedBranch("");
      setSelectedPipelineId("");
      setSelectedPipelineName("");
      setQueuedBuild(null);
    }
    onOpenChange(val);
  };

  // ADO: need repo + branch + pipeline. External: only branch (pipeline optional).
  const canRun = hasProvider && (isAdo
    ? !!(selectedRepoId && selectedBranch && selectedPipelineId)
    : !!selectedBranch);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-blue-500" />
            Run Build
          </DialogTitle>
          <DialogDescription>
            {!hasProvider
              ? "CI/CD is not configured for this project."
              : isAdo
              ? "Select a repository, branch, and pipeline to trigger a build in Azure DevOps."
              : `Select a branch${extPipelines.length > 0 ? ` and ${pipelineLabel.toLowerCase()}` : ""} to trigger a build in ${providerLabel}.`}
          </DialogDescription>
        </DialogHeader>

        {queuedBuild ? (
          <div className="py-6 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <div>
              <div className="font-semibold text-base">Build Triggered Successfully</div>
              <div className="text-sm text-muted-foreground mt-1">
                Build <span className="font-medium">#{queuedBuild.buildNumber || queuedBuild.id}</span>{" "}
                has been queued in <span className="font-medium">{providerLabel}</span>.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">{queuedBuild.status || "queued"}</Badge>
              {queuedBuild._links?.web?.href && (
                <a
                  href={queuedBuild._links.web.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in {providerLabel}
                </a>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQueuedBuild(null);
                setSelectedBranch("");
                setSelectedPipelineId("");
                setSelectedPipelineName("");
              }}
            >
              Queue Another Build
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {!hasProvider && (
              <div className="flex items-start gap-2 text-xs text-amber-900 p-2 border border-amber-200 rounded-md bg-amber-50">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Configure a CI/CD integration for this project before running a build.
              </div>
            )}

            {/* ADO only: repository step */}
            {isAdo && (
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
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                Branch
              </Label>
              {!hasProvider ? (
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="CI/CD is not configured" />
                  </SelectTrigger>
                </Select>
              ) : isAdo && !selectedRepoId ? (
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository first" />
                  </SelectTrigger>
                </Select>
              ) : branchesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : branchesError ? (
                <div className="flex items-start gap-2 text-xs text-destructive p-2 border border-destructive/30 rounded-md bg-destructive/10">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {branchesErrorMessage}
                </div>
              ) : branches.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2 border rounded-md bg-muted/50">
                  No branches found.
                </div>
              ) : (
                <Select
                  key={selectedRepoId || "ext"}
                  value={selectedBranch || undefined}
                  onValueChange={setSelectedBranch}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch: any) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Pipeline / Workflow (optional for external providers) */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <Play className="h-3.5 w-3.5 text-muted-foreground" />
                {pipelineLabel}
                {hasProvider && !isAdo && (
                  <span className="text-xs text-muted-foreground font-normal ml-1">(optional — defaults to latest)</span>
                )}
              </Label>
              {!hasProvider ? (
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="CI/CD is not configured" />
                  </SelectTrigger>
                </Select>
              ) : isAdo && !selectedRepoId ? (
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository first" />
                  </SelectTrigger>
                </Select>
              ) : pipelinesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : pipelinesError ? (
                <div className="text-xs text-destructive p-2 border border-destructive/30 rounded-md bg-destructive/10">
                  {pipelinesErrorMessage}
                </div>
              ) : pipelines.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2 border rounded-md bg-muted/50">
                  {isAdo ? "No pipelines found for this repository." : `No ${pipelineLabel.toLowerCase()}s found — a new run will be created on the selected branch.`}
                </div>
              ) : (
                <Select value={selectedPipelineId} onValueChange={handlePipelineChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select a ${pipelineLabel.toLowerCase()}...`} />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline: any) => (
                      <SelectItem key={pipeline.id} value={String(pipeline.id)}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canRun || queueBuildMutation.isPending}
                onClick={() => queueBuildMutation.mutate()}
              >
                {queueBuildMutation.isPending ? (
                  <>Triggering…</>
                ) : (
                  <>
                    <Rocket className="h-3.5 w-3.5 mr-1.5" />
                    Run Build
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
