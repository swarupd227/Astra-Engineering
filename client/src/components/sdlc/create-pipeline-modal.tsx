import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useIsAuthenticated } from "@azure/msal-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ExternalLink, GitBranch, Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ProviderSegment = "ado" | "gitlab" | "github" | "bitbucket";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  projectName?: string;
  adoOrganization?: string | null;
  providerSegment?: ProviderSegment;
}

function getProviderLabel(seg: ProviderSegment): string {
  if (seg === "gitlab") return "GitLab";
  if (seg === "github") return "GitHub Actions";
  if (seg === "bitbucket") return "Bitbucket Pipelines";
  return "Azure DevOps";
}

export function CreatePipelineModal({
  open,
  onOpenChange,
  projectId,
  projectName,
  adoOrganization,
  providerSegment = "ado",
}: Props) {
  const { toast } = useToast();
  const isAuthenticated = useIsAuthenticated();
  const isAdo = providerSegment === "ado";
  const providerLabel = getProviderLabel(providerSegment);

  // ── ADO state ──────────────────────────────────────────────────
  const [pipelineName, setPipelineName] = useState("");
  const [repoName, setRepoName] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [yamlPath, setYamlPath] = useState("azure-pipelines.yml");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── External provider state ────────────────────────────────────
  const [extBranch, setExtBranch] = useState("");
  const [triggeredRun, setTriggeredRun] = useState<any>(null);

  // ── ADO: repositories ──────────────────────────────────────────
  const { data: reposData } = useQuery({
    queryKey: ["create-pipeline", "repos", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        const apiProject = projectId || "default";
        let url = `/api/sdlc/projects/${apiProject}/ado/repositories`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch {
        return null;
      }
    },
    enabled: isAuthenticated && open && isAdo && (Boolean(projectId) || Boolean(projectName)),
  });

  // ── ADO: branches per selected repo ───────────────────────────
  const { data: branchesData } = useQuery({
    queryKey: ["create-pipeline", "repo-branches", projectId, selectedRepoId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        if (!selectedRepoId) return [];
        const apiProject = projectId || "default";
        let url = `/api/sdlc/projects/${apiProject}/ado/repositories/${selectedRepoId}/branches`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch {
        return null;
      }
    },
    enabled: isAuthenticated && open && isAdo && !!selectedRepoId && (Boolean(projectId) || Boolean(projectName)),
  });

  // ── External provider: branches ────────────────────────────────
  const { data: extBranchesRaw, isLoading: extBranchesLoading, isError: extBranchesError } = useQuery<any>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/branches`],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/${providerSegment}/branches`).then(
        (r) => r.json()
      ),
    enabled: open && !!projectId && !isAdo,
    staleTime: 60_000,
    retry: 1,
  });
  const extBranches: Array<{ name: string }> = (() => {
    if (!extBranchesRaw) return [];
    if (Array.isArray(extBranchesRaw)) return extBranchesRaw;
    if (Array.isArray(extBranchesRaw.value)) return extBranchesRaw.value;
    return [];
  })();

  const normalize = (d: any) => (d && ((d as any).value || d)) || [];

  // Reset on project/org change
  useEffect(() => {
    setSelectedRepoId(null);
    setRepoName("");
    setBranch("");
  }, [projectName, adoOrganization]);

  // Auto-select first ADO branch
  useEffect(() => {
    try {
      const list = normalize(branchesData || []);
      if (selectedRepoId) {
        if (list.length) {
          const first = list[0];
          const name = first?.name || first?.objectId || "";
          setBranch((prev) => (prev ? prev : String(name)));
        } else {
          setBranch("");
        }
      }
    } catch {
      // ignore
    }
  }, [branchesData, selectedRepoId]);

  // ── ADO: create pipeline ────────────────────────────────────────
  const handleAdoCreate = async () => {
    if (!pipelineName) {
      toast({ title: "Name required", description: "Please provide a pipeline name.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const apiProject = projectId || "default";
      let finalRepoName = repoName;
      try {
        const reposList = normalize(reposData);
        if (selectedRepoId) {
          const found = reposList.find((r: any) => String(r.id) === String(selectedRepoId));
          if (found) finalRepoName = found.name || found.remoteUrl || found.url || finalRepoName;
        }
      } catch {}

      const body = { pipelineName, repoName: finalRepoName, branch, yamlPath, projectName, organization: adoOrganization };
      const res = await apiRequest("POST", `/api/sdlc/projects/${apiProject}/ado/pipelines`, body);
      if (!res) throw new Error("No response from server");
      toast({ title: "Pipeline Created", description: `${pipelineName} created (or request sent).` });
      try { queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/pipelines"] }); } catch {}
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to create pipeline", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── External provider: trigger pipeline run ─────────────────────
  const triggerRunMutation = useMutation({
    mutationFn: async () => {
      if (!extBranch.trim()) throw new Error("Branch is required");
      const res = await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/${providerSegment}/queue-build`,
        { branchName: extBranch.trim() }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || `Failed to trigger ${providerLabel} pipeline`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setTriggeredRun(data);
      toast({
        title: "Pipeline Triggered",
        description: `Pipeline run #${data.buildNumber || data.id} triggered on branch "${extBranch}" in ${providerLabel}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Trigger Pipeline", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleClose = (val: boolean) => {
    if (!val) {
      setSelectedRepoId(null);
      setRepoName("");
      setBranch("");
      setPipelineName("");
      setYamlPath("azure-pipelines.yml");
      setExtBranch("");
      setTriggeredRun(null);
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isAdo ? "Create Pipeline" : `Trigger Pipeline — ${providerLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isAdo
              ? "Provide pipeline details to create a new pipeline in Azure DevOps."
              : `Select a branch to trigger a new pipeline run in ${providerLabel}. Pipelines are defined by config files in your repository.`}
          </DialogDescription>
        </DialogHeader>

        {/* ── Non-ADO ─────────────────────────────────────────── */}
        {!isAdo && (
          <>
            {triggeredRun ? (
              <div className="py-4 flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <div>
                  <div className="font-semibold">Pipeline Run Triggered</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Run <span className="font-medium">#{triggeredRun.buildNumber || triggeredRun.id}</span> on branch{" "}
                    <span className="font-medium">"{extBranch}"</span> is now queued in {providerLabel}.
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <Badge variant="secondary">{triggeredRun.status || "queued"}</Badge>
                  {triggeredRun._links?.web?.href && (
                    <a
                      href={triggeredRun._links.web.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View in {providerLabel}
                    </a>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => { setTriggeredRun(null); setExtBranch(""); }}>
                  Trigger Another Run
                </Button>
              </div>
            ) : (
              <div className="space-y-3 mt-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-sm">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    Branch
                  </Label>
                  {extBranchesLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : extBranchesError ? (
                    <div className="flex items-start gap-2 text-xs text-destructive p-2 border border-destructive/30 rounded-md bg-destructive/10">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Failed to load branches. Ensure {providerLabel} is configured for this project in Settings.
                    </div>
                  ) : extBranches.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-2 border rounded-md bg-muted/50">
                      No branches found.
                    </div>
                  ) : (
                    <Select value={extBranch} onValueChange={setExtBranch}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a branch..." />
                      </SelectTrigger>
                      <SelectContent>
                        {extBranches.map((b) => (
                          <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}

            {!triggeredRun && (
              <DialogFooter>
                <div className="flex gap-2 w-full">
                  <Button variant="outline" onClick={() => handleClose(false)} className="w-full">Cancel</Button>
                  <Button
                    onClick={() => triggerRunMutation.mutate()}
                    disabled={!extBranch || triggerRunMutation.isPending}
                    className="w-full"
                  >
                    {triggerRunMutation.isPending ? (
                      "Triggering…"
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Play className="h-3.5 w-3.5" />
                        Trigger Run
                      </span>
                    )}
                  </Button>
                </div>
              </DialogFooter>
            )}
          </>
        )}

        {/* ── ADO (unchanged) ─────────────────────────────────── */}
        {isAdo && (
          <>
            <div className="space-y-3 mt-2">
              <div>
                <Label>Pipeline Name</Label>
                <Input value={pipelineName} onChange={(e) => setPipelineName(e.target.value)} placeholder="e.g., backend-build" />
              </div>
              <div>
                <Label>Repository (optional)</Label>
                <Select value={selectedRepoId ?? ""} onValueChange={(v) => {
                  setSelectedRepoId(v || null);
                  try {
                    const reposList = normalize(reposData);
                    const found = reposList.find((r: any) => String(r.id) === String(v));
                    if (found) setRepoName(found.name || found.remoteUrl || found.url || "");
                    else setRepoName("");
                  } catch {
                    setRepoName("");
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder={normalize(reposData).length ? "Select repository" : "No repositories"} />
                  </SelectTrigger>
                  <SelectContent>
                    {normalize(reposData).map((r: any) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name || r.remoteUrl || r.url}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Branch</Label>
                <Select disabled={!selectedRepoId} value={branch} onValueChange={(v) => setBranch(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={!selectedRepoId ? "Select repository first" : (normalize(branchesData).length ? "Select branch" : "No branches")} />
                  </SelectTrigger>
                  <SelectContent>
                    {normalize(branchesData).map((b: any) => (
                      <SelectItem key={b.name || b.commit?.id || b.objectId} value={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>YAML Path</Label>
                <Input value={yamlPath} onChange={(e) => setYamlPath(e.target.value)} placeholder="azure-pipelines.yml" />
              </div>
            </div>

            <DialogFooter>
              <div className="flex gap-2 w-full">
                <Button variant="outline" onClick={() => handleClose(false)} className="w-full">Cancel</Button>
                <Button onClick={handleAdoCreate} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? "Creating..." : "Create Pipeline"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
