import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  PlayCircle,
  StopCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Upload,
  Download,
  Terminal,
  FileText,
  Package,
  Rocket,
  Activity,
  TrendingUp,
  AlertCircle,
  Server,
  Zap,
  Flag,
  Eye,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useIsAuthenticated } from "@azure/msal-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ActionType =
  | "run-cicd"
  | "view-test-report"
  | "publish-package"
  | "trigger-release"
  | "manage-feature-flags"
  | "open-monitoring"
  | "push-code"
  | "create-mr"
  | "review-code"
  | "create-target"
  | "assign-reviewers"
  | "link-jira"
  | "review-design"
  | "upload-diagram"
  | "export-figma"
  | "goto-reports";

interface CICDActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: ActionType | null;
  projectId: string;
  projectName: string;
  phaseName: string;
  adoOrganization?: string | null;
}

type PipelineStage = {
  name: string;
  status: "pending" | "running" | "success" | "failed";
  duration?: string;
  logs?: string[];
};

export function CICDActionDialog({
  open,
  onOpenChange,
  actionType,
  projectId,
  projectName,
  phaseName,
  adoOrganization,
}: CICDActionDialogProps) {
  const { toast } = useToast();
  const isAuthenticated = useIsAuthenticated();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState(0);
  const [environment, setEnvironment] = useState("staging");
  const [version, setVersion] = useState("1.0.0");
  const [featureFlags, setFeatureFlags] = useState([
    { id: "1", name: "new-ui-design", enabled: true, rollout: 100 },
    { id: "2", name: "ai-suggestions", enabled: true, rollout: 50 },
    { id: "3", name: "dark-mode-v2", enabled: false, rollout: 0 },
  ]);

  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([
    { name: "Build", status: "pending" },
    { name: "Test", status: "pending" },
    { name: "Security Scan", status: "pending" },
    { name: "Deploy", status: "pending" },
  ]);

  const [selectedPipeline, setSelectedPipeline] = useState<number | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

  const getDialogTitle = () => {
    switch (actionType) {
      case "run-cicd":
        return "Run CI/CD Pipeline";
      case "view-test-report":
        return "Test Reports";
      case "publish-package":
        return "Publish Package";
      case "trigger-release":
        return "Trigger Release";
      case "manage-feature-flags":
        return "Manage Feature Flags";
      case "open-monitoring":
        return "Monitoring Dashboard";
      case "push-code":
        return "Push Code";
      case "create-mr":
        return "Create Merge Request";
      case "review-code":
        return "Review Code";
      case "create-target":
        return "Create Target";
      case "assign-reviewers":
        return "Assign Reviewers";
      case "link-jira":
        return "Link Jira Ticket";
      case "review-design":
        return "Review Design";
      case "upload-diagram":
        return "Upload Architecture Diagram";
      case "export-figma":
        return "Export to Figma";
      case "goto-reports":
        return "Go to Reports";
      default:
        return "Action";
    }
  };

  const getDialogDescription = () => {
    switch (actionType) {
      case "run-cicd":
        return `Execute CI/CD pipeline for ${projectName} - ${phaseName}`;
      case "view-test-report":
        return `View test results and coverage for ${projectName}`;
      case "publish-package":
        return `Publish package to registry for ${projectName}`;
      case "trigger-release":
        return `Deploy ${projectName} to production environment`;
      case "manage-feature-flags":
        return `Control feature rollout for ${projectName}`;
      case "open-monitoring":
        return `Monitor performance and health of ${projectName}`;
      case "push-code":
        return `Push your local changes to the remote repository for ${projectName}`;
      case "create-mr":
        return `Create a new merge request for ${projectName}`;
      case "review-code":
        return `Review pending code changes for ${projectName}`;
      case "create-target":
        return `Create a new epic or target milestone for ${projectName}`;
      case "assign-reviewers":
        return `Assign team members to review work items in ${projectName}`;
      case "link-jira":
        return `Link Jira tickets to work items in ${projectName}`;
      case "review-design":
        return `Review design mockups and assets for ${projectName}`;
      case "upload-diagram":
        return `Upload architecture diagrams and technical documentation for ${projectName}`;
      case "export-figma":
        return `Export design assets to Figma for ${projectName}`;
      case "goto-reports":
        return `View maintenance and performance reports for ${projectName}`;
      default:
        return "";
    }
  };

  const buildAdoQuery = (extra?: Record<string, string | number | boolean>) => {
    const params = new URLSearchParams();
    if (adoOrganization) params.set("organization", String(adoOrganization));
    if (projectName) params.set("projectName", String(projectName));
    if (extra) {
      Object.entries(extra).forEach(([k, v]) => {
        if (v !== undefined && v !== null) params.set(k, String(v));
      });
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const runCICDPipeline = async () => {
    setIsRunning(true);
    setProgress(0);

    const stages = [...pipelineStages];
    for (let i = 0; i < stages.length; i++) {
      setCurrentStage(i);
      stages[i].status = "running";
      setPipelineStages([...stages]);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const success = Math.random() > 0.1;
      stages[i].status = success ? "success" : "failed";
      stages[i].duration = `${(Math.random() * 30 + 10).toFixed(1)}s`;
      stages[i].logs = [
        `[${new Date().toLocaleTimeString()}] Starting ${stages[i].name}...`,
        `[${new Date().toLocaleTimeString()}] Processing dependencies...`,
        `[${new Date().toLocaleTimeString()}] ${success ? "✓ Completed successfully" : "✗ Failed"}`,
      ];
      setPipelineStages([...stages]);
      setProgress(((i + 1) / stages.length) * 100);

      if (!success) {
        setIsRunning(false);
        toast({
          title: "Pipeline Failed",
          description: `${stages[i].name} stage failed. Check logs for details.`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsRunning(false);
    toast({
      title: "Pipeline Completed",
      description: "All stages completed successfully!",
    });
  };

  const publishPackage = () => {
    toast({
      title: "Package Published",
      description: `Version ${version} published to registry successfully!`,
    });
    onOpenChange(false);
  };

  const triggerRelease = () => {
    toast({
      title: "Release Triggered",
      description: `Deploying to ${environment} environment...`,
    });
    onOpenChange(false);
  };

  const updateFeatureFlag = (id: string, enabled: boolean) => {
    setFeatureFlags(
      featureFlags.map((flag) =>
        flag.id === id ? { ...flag, enabled } : flag
      )
    );
    toast({
      title: "Feature Flag Updated",
      description: `Flag ${featureFlags.find((f) => f.id === id)?.name} ${enabled ? "enabled" : "disabled"}`,
    });
  };

  // Fetch pipelines and builds for deployment options when dialog is open
  const { data: pipelinesData, isLoading: isLoadingPipelines } = useQuery({
    queryKey: ["cicd", "pipelines", projectId, projectName, adoOrganization, selectedRepoId, selectedBranch],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/pipelines`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        if (selectedRepoId) params.append("repositoryId", String(selectedRepoId));
        if (selectedBranch) params.append("branch", String(selectedBranch));
        const query = params.toString();
        if (query) url = `${url}?${query}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: !!adoOrganization && (Boolean(projectId) || Boolean(projectName)) && open,
  });

  const { data: buildsData, isLoading: isLoadingBuilds } = useQuery({
    queryKey: ["cicd", "builds", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/builds`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const query = params.toString();
        if (query) url = `${url}?${query}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: !!adoOrganization && (Boolean(projectId) || Boolean(projectName)) && open,
  });

  // Additional ADO queries: releases, release-definitions, deployments, release-artifacts, deployment-summary
  const { data: releaseDefsData, isLoading: isLoadingReleaseDefs } = useQuery({
    queryKey: ["cicd", "release-definitions", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/release-definitions`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: !!adoOrganization && (Boolean(projectId) || Boolean(projectName)) && open,
  });

  const { data: releasesData, isLoading: isLoadingReleases } = useQuery({
    queryKey: ["cicd", "releases", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/releases`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: isAuthenticated && !!adoOrganization && (Boolean(projectId) || Boolean(projectName)) && open,
  });

  const { data: deploymentsData, isLoading: isLoadingDeployments } = useQuery({
    queryKey: ["cicd", "deployments", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/deployments`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: isAuthenticated && !!adoOrganization && !!projectId && open,
  });

  const { data: releaseArtifactsData, isLoading: isLoadingArtifacts } = useQuery({
    queryKey: ["cicd", "release-artifacts", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/release-artifacts`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: isAuthenticated && !!adoOrganization && !!projectId && open,
  });

  const { data: testRunsData, isLoading: isLoadingTestRuns } = useQuery({
    queryKey: ["cicd", "test-runs", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/test-runs`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: isAuthenticated && !!adoOrganization && !!projectId && open,
  });

  // Fetch repositories for the selected project/org
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ["cicd", "repos", projectId, projectName, adoOrganization],
    queryFn: async () => {
      try {
        let url = `/api/sdlc/projects/${projectId}/ado/repositories`;
        const params = new URLSearchParams();
        if (adoOrganization) params.append("organization", adoOrganization);
        if (projectName) params.append("projectName", projectName);
        const q = params.toString();
        if (q) url = `${url}?${q}`;
        const res = await apiRequest("GET", url);
        return await res.json();
      } catch (err) {
        return null;
      }
    },
    enabled: isAuthenticated && !!adoOrganization && (Boolean(projectId) || Boolean(projectName)) && open,
  });

  // Fetch branches for selected repo - allow errors to surface so we can show diagnostics
  const { data: branchesData, isLoading: isLoadingBranches, error: branchesError } = useQuery({
    queryKey: ["cicd", "repo-branches", projectId, selectedRepoId, projectName, adoOrganization],
    queryFn: async () => {
      if (!selectedRepoId) return [];
      let url = `/api/sdlc/projects/${projectId}/ado/repositories/${selectedRepoId}/branches`;
      const params = new URLSearchParams();
      if (adoOrganization) params.append("organization", adoOrganization);
      if (projectName) params.append("projectName", projectName);
      const q = params.toString();
      if (q) url = `${url}?${q}`;
      const res = await apiRequest("GET", url);
      return await res.json();
    },
    enabled: isAuthenticated && !!selectedRepoId && ((Boolean(projectId) || Boolean(projectName)) && open),
  });

  // Debug: log selected repo and branches result to console for diagnosis
  useEffect(() => {
    console.log("[CICD] selectedRepoId:", selectedRepoId);
  }, [selectedRepoId]);

  // Reset selections when project or organization changes
  useEffect(() => {
    setSelectedRepoId(null);
    setSelectedBranch("");
    setSelectedPipeline(null);
  }, [projectName, adoOrganization]);

  useEffect(() => {
    console.log("[CICD] branchesData:", branchesData, "branchesError:", branchesError);
  }, [branchesData, branchesError]);

  const renderTestReport = () => (
    <div className="space-y-4">
      <h4 className="font-medium">Test Runs</h4>
      {(((testRunsData as any) && ((testRunsData as any).value || (testRunsData as any))) || []).length ? (
        (((testRunsData as any).value || (testRunsData as any)) || []).map((tr: any) => (
          <div key={tr.id} className="p-2 border rounded">
            <div className="font-medium">{tr.name}</div>
            <div className="text-sm text-muted-foreground">{tr.state} • {tr.totalTests || 0} tests</div>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline">View Report</Button>
            </div>
          </div>
        ))
      ) : (
        <div className="text-sm text-muted-foreground">No test runs found.</div>
      )}
    </div>
  );

  const renderTriggerRelease = () => (
    <div className="space-y-4">
      <h4 className="font-medium">Trigger Release</h4>
      {(Array.isArray(releaseArtifactsData?.value) ? releaseArtifactsData.value : Array.isArray(releaseArtifactsData) ? releaseArtifactsData : []).length ? (
        (Array.isArray(releaseArtifactsData?.value) ? releaseArtifactsData.value : Array.isArray(releaseArtifactsData) ? releaseArtifactsData : []).map((a: any) => {
          const runLabel = a.version || a.name;
          const showRunSub =
            runLabel && a.definitionName && String(runLabel).trim() !== String(a.definitionName).trim();
          return (
            <div key={a.id} className="p-2 border rounded flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{a.definitionName || "Release pipeline"}</div>
                {showRunSub ? (
                  <div className="text-sm text-muted-foreground truncate">Last run: {runLabel}</div>
                ) : null}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  className="w-full"
                  variant="default"
                  disabled={a.definitionId == null}
                  onClick={() => triggerReleaseAction(a)}
                >
                  Trigger
                </Button>
              </div>
            </div>
          );
        })
      ) : (
        <div className="text-sm text-muted-foreground">No release artifacts available.</div>
      )}
    </div>
  );

  const renderPublishPackage = () => (
    <div className="space-y-4">
      <h4 className="font-medium">Publish Package</h4>
      <div className="space-y-2">
        <Label>Version</Label>
        <Input value={version} onChange={(e) => setVersion((e.target as HTMLInputElement).value)} />
        <div className="flex gap-2">
          <Button onClick={publishPackage} className="w-full">Publish</Button>
        </div>
      </div>
    </div>
  );

  const triggerReleaseAction = async (artifact: { definitionId?: number; definitionName?: string; version?: string; name?: string }) => {
    if (artifact.definitionId == null) {
      toast({
        title: "Error",
        description: "This item has no release definition ID. Check Azure DevOps classic release definitions.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsRunning(true);
      let url = `/api/sdlc/projects/${projectId}/ado/trigger-release`;
      const params = new URLSearchParams();
      if (adoOrganization) params.append("organization", adoOrganization);
      if (projectName) params.append("projectName", projectName);
      const q = params.toString();
      if (q) url = `${url}?${q}`;
      await apiRequest("POST", url, {
        definitionId: artifact.definitionId,
        description: `Release ${artifact.definitionName || "pipeline"} triggered from DevX`,
      });
      // Invalidate relevant queries so UI updates (cards, lists) reflect the triggered release
      try {
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/releases"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/deployments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/release-artifacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/builds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/pipelines"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/test-runs"] });
        queryClient.invalidateQueries({ queryKey: ["cicd"] });
      } catch (ie) {
        // Best-effort invalidation; continue
      }

      toast({ title: "Triggered", description: "Release trigger request sent." });
      setIsRunning(false);
      onOpenChange(false);
    } catch (err) {
      setIsRunning(false);
      toast({ title: "Error", description: "Failed to trigger release.", variant: "destructive" });
    }
  };

  const renderRunCICD = () => {
    const normalize = (d: any) => (d && ((d as any).value || d)) || [];
    const pipelinesList = normalize(pipelinesData);
    const filterByRepo = (p: any) => {
      if (!selectedRepoId) return true;
      const repoId = p.repository?.id || p.repositoryId || null;
      return repoId ? String(repoId) === String(selectedRepoId) : true;
    };

    const filterByBranch = (p: any) => {
      // require an explicit branch selection before showing pipelines
      if (!selectedBranch) return false;
      const defaultBranch = (p.repository?.defaultBranch || p.defaultBranch || "").replace("refs/heads/", "");
      if (!defaultBranch) return true;
      return defaultBranch.includes(selectedBranch) || selectedBranch.includes(defaultBranch);
    };

    const visiblePipelines = pipelinesList.filter((p: any) => filterByRepo(p) && filterByBranch(p));
    const deploymentsList = normalize(deploymentsData);
    const releaseArtifactsList = normalize(releaseArtifactsData);
    const buildsList = normalize(buildsData);
    // Repos and branches
    const reposList = normalize((reposData as any) || []);
    // Primary branches from branchesData
    let branchesList = normalize((branchesData as any) || []);
    // If branch API returned empty, try to derive branches from pipelines data for the selected repo
    if ((!branchesList || branchesList.length === 0) && selectedRepoId) {
      const derived = pipelinesList
        .filter((p: any) => {
          const repoId = p.repository?.id || p.repositoryId || null;
          return repoId ? String(repoId) === String(selectedRepoId) : false;
        })
        .map((p: any) => {
          const raw = (p.repository?.defaultBranch || p.defaultBranch || "") as string;
          return raw.replace(/^refs\/heads\//, "");
        })
        .filter(Boolean);
      // Unique
      const unique = Array.from(new Set(derived));
      if (unique.length) branchesList = unique.map((n) => ({ name: n, objectId: n }));
    }

    // Prepare pipelines content to avoid nested JSX ternaries
    let pipelinesContent: any = null;
    if (!selectedRepoId || !selectedBranch) {
      pipelinesContent = <div className="text-sm text-muted-foreground">Select repository and branch to view pipelines.</div>;
    } else if (visiblePipelines.length) {
      pipelinesContent = visiblePipelines.map((p: any) => (
        <div key={p.id} className="p-2 border rounded flex items-center justify-between">
          <div>
            <div className="font-medium">{p.name}</div>
            <div className="text-sm text-muted-foreground">{p.path || p.url || p.repository?.name}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => {
              setSelectedPipeline(p.id);
              const repoId = p.repository?.id || p.repositoryId || null;
              if (repoId) setSelectedRepoId(String(repoId));
              const defaultBranch = p.repository?.defaultBranch || p.defaultBranch || "";
              setSelectedBranch(defaultBranch ? defaultBranch.replace('refs/heads/', '') : "");
              runPipelineAction(p.id);
            }}>Run</Button>
          </div>
        </div>
      ));
    } else {
      pipelinesContent = <div className="text-sm text-muted-foreground">No pipelines found for the selected branch.</div>;
    }

    return (
      <Tabs defaultValue="pipelines" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          <TabsTrigger value="deployment-status">Deployment Status</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
          <TabsTrigger value="build-history">Build History</TabsTrigger>
        </TabsList>

        <TabsContent value="pipelines" className="space-y-4">
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <Label>Repository *</Label>
                <Select value={selectedRepoId ?? ""} onValueChange={(v) => {
                  const repoId = v || null;
                  setSelectedRepoId(repoId);
                  setSelectedBranch("");
                  setSelectedPipeline(null);
                  try {
                    queryClient.invalidateQueries({ queryKey: ["cicd", "repo-branches", projectId, repoId, projectName, adoOrganization] });
                    queryClient.invalidateQueries({ queryKey: ["cicd", "pipelines", projectId, projectName, adoOrganization, repoId, ""] });
                  } catch (e) { }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder={reposList.length ? "Select repository" : "No repositories"} />
                  </SelectTrigger>
                  <SelectContent>
                    {reposList.map((r: any) => {
                      const val = String(r.id ?? r.repositoryId ?? r.name ?? "");
                      const key = val || String(r.name || Math.random());
                      return <SelectItem key={key} value={val}>{r.name}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Branch *</Label>
                <Select disabled={!selectedRepoId} value={selectedBranch} onValueChange={(v) => setSelectedBranch(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={!selectedRepoId ? "Select repository first" : (isLoadingBranches ? "Loading branches..." : (branchesList.length ? "Select branch" : "No branches"))} />
                  </SelectTrigger>
                  <SelectContent>
                    {branchesList.map((b: any) => {
                      const raw = b.name || b.objectId || (b.commit && b.commit.id) || "";
                      const name = String(raw).replace(/^refs\/heads\//, "");
                      return <SelectItem key={name} value={name}>{name}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
                {branchesError && (!branchesList || branchesList.length === 0) ? (
                  <div className="text-sm text-destructive mt-1">Failed to load branches (server error). Configure ADO credentials or use pipeline-derived branches.</div>
                ) : null}
                {(!branchesError && (!branchesList || branchesList.length === 0)) ? (
                  <div className="text-sm text-muted-foreground mt-1">No branches found for the selected repository.</div>
                ) : null}
              </div>

              {/* Pipeline select removed — use Available Pipelines list below to pick and run a pipeline */}

              <div className="flex items-center">
                <div className="w-full">
                  <Button className="w-full" onClick={() => {
                    if (!selectedRepoId) {
                      toast({ title: "Select Repository", description: "Please select a repository first.", variant: "destructive" });
                      return;
                    }
                    if (!selectedBranch) {
                      toast({ title: "Select Branch", description: "Please select a branch first.", variant: "destructive" });
                      return;
                    }
                    if (!selectedPipeline) {
                      toast({ title: "Select Pipeline", description: "Please choose a pipeline from Available Pipelines below and click its Run button.", variant: "destructive" });
                      return;
                    }
                    runPipelineAction(selectedPipeline);
                  }}>
                    Run
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium">Available Pipelines</h4>
              {pipelinesContent}
            </div>

            {/* Build History moved to its own tab (see TabsContent "build-history") */}
          </div>
        </TabsContent>

        <TabsContent value="build-history" className="space-y-4">
          <div>
            <h4 className="font-medium">Build History</h4>
            {buildsList.length ? (
              buildsList.slice(0, 50).map((b: any) => {
                const statusText = (b.result || b.status || '').toString();
                const triggeredBy = b.requestedFor?.displayName || b.requestedFor?.uniqueName || b.triggerInfo?.requestedFor || b.triggerInfo?.manual ? (b.requestedFor?.displayName || 'Manual') : (b.triggerInfo?.ci ? 'CI' : (b.triggerInfo?.scheduled ? 'Scheduled' : 'Unknown'));
                return (
                  <div key={b.id} className="p-2 border rounded flex items-center justify-between">
                    <div>
                      <div className="font-medium">#{b.id} • {b.buildNumber || b.id}</div>
                      <div className="text-sm text-muted-foreground">{statusText} • {b.finishTime || b.queueTime}</div>
                      <div className="text-sm text-muted-foreground">Triggered by: {triggeredBy}</div>
                    </div>
                    <div className="text-sm">
                      {statusText.toLowerCase().includes("suc") ? <Badge className="bg-green-500">Success</Badge> : (statusText.toLowerCase().includes("fail") ? <Badge className="bg-rose-600">Failed</Badge> : <Badge className="bg-amber-400">{b.status || b.result || 'Queued'}</Badge>)}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-muted-foreground">No builds found.</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="deployment-status" className="space-y-4">
          {deploymentsList.length ? (
            deploymentsList.map((d: any) => (
              <div key={d.id} className="p-2 border rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{d.releaseName}</div>
                    <div className="text-sm text-muted-foreground">{d.environmentName} • {d.deploymentStatus}</div>
                  </div>
                  <div className="text-sm text-muted-foreground">{d.startedOn}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No deployments found.</div>
          )}
        </TabsContent>

        <TabsContent value="releases" className="space-y-4">
          {releaseArtifactsList.length ? (
            releaseArtifactsList.map((a: any) => {
              const runLabel = a.version || a.name;
              const showRunSub =
                runLabel && a.definitionName && String(runLabel).trim() !== String(a.definitionName).trim();
              return (
                <div key={a.id} className="p-2 border rounded flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.definitionName || "Release pipeline"}</div>
                    {showRunSub ? (
                      <div className="text-sm text-muted-foreground truncate">Last run: {runLabel}</div>
                    ) : null}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="w-full"
                      disabled={a.definitionId == null}
                      onClick={() => triggerReleaseAction(a)}
                    >
                      Deploy
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-sm text-muted-foreground">No release artifacts available.</div>
          )}
        </TabsContent>
      </Tabs>
    );
  };

  // Try to run a pipeline via backend; fall back to local simulation on failure
  const runPipelineAction = async (pipelineId: number) => {
    if (!projectId && !projectName) {
      toast({ title: "Missing Project", description: "Select a project first.", variant: "destructive" });
      return;
    }

    setIsRunning(true);
    try {
      const apiProject = projectId || "default";
      const qs = projectName ? `?projectName=${encodeURIComponent(projectName)}` : "";
      const res = await apiRequest("POST", `/api/sdlc/projects/${apiProject}/ado/pipelines/${pipelineId}/run${qs}`);
      // If backend supports run, it should return run info
      toast({ title: "Pipeline Queued", description: "Pipeline run request sent." });
      try { queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects", projectId, "ado/pipelines"] }); } catch (ie) { }
      setIsRunning(false);
    } catch (err) {
      // Fallback: local simulation
      toast({ title: "Fallback", description: "Backend run failed; using local simulation." });
      await runCICDPipeline();
    }
  };

  const renderFeatureFlags = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Feature Flags</h3>
        <Button size="sm" data-testid="button-add-flag">
          <Flag className="mr-2 h-4 w-4" />
          Add Flag
        </Button>
      </div>
      <div className="space-y-3">
        {featureFlags.map((flag) => (
          <div
            key={flag.id}
            className="p-4 border rounded-lg space-y-3"
            data-testid={`flag-${flag.id}`}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="font-medium">{flag.name}</div>
                <div className="text-sm text-muted-foreground">
                  Rollout: {flag.rollout}%
                </div>
              </div>
              <Switch
                checked={flag.enabled}
                onCheckedChange={(checked) =>
                  updateFeatureFlag(flag.id, checked)
                }
                data-testid={`switch-${flag.id}`}
              />
            </div>
            <Progress value={flag.rollout} className="h-2" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderMonitoring = () => (
    <Tabs defaultValue="metrics" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="metrics" data-testid="tab-metrics">
          Metrics
        </TabsTrigger>
        <TabsTrigger value="logs" data-testid="tab-logs">
          Logs
        </TabsTrigger>
        <TabsTrigger value="health" data-testid="tab-health">
          Health
        </TabsTrigger>
      </TabsList>

      <TabsContent value="metrics" className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "CPU Usage", value: "42%", icon: Activity },
            { label: "Memory", value: "1.2 GB", icon: Server },
            { label: "Requests/min", value: "1,247", icon: TrendingUp },
            { label: "Error Rate", value: "0.03%", icon: AlertCircle },
          ].map((metric, idx) => (
            <div
              key={idx}
              className="p-4 border rounded-lg"
              data-testid={`metric-${idx}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <metric.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {metric.label}
                </span>
              </div>
              <div className="text-2xl font-bold">{metric.value}</div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="logs" className="space-y-2">
        <ScrollArea className="h-64">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="p-3 border rounded-lg mb-2 font-mono text-xs"
              data-testid={`log-${i}`}
            >
              <span className="text-muted-foreground">
                [{new Date().toLocaleTimeString()}]
              </span>{" "}
              <span>Request processed successfully - 200 OK</span>
            </div>
          ))}
        </ScrollArea>
      </TabsContent>

      <TabsContent value="health" className="space-y-4">
        <div className="p-4 border rounded-lg bg-green-500/10">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="font-medium text-green-500">All Systems Operational</span>
          </div>
        </div>
        <div className="space-y-2">
          {["Database", "API Server", "Cache", "CDN"].map((service, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 border rounded-lg"
              data-testid={`service-${idx}`}
            >
              <span>{service}</span>
              <Badge variant="default" className="bg-green-500">
                Healthy
              </Badge>
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );

  // Development Phase Actions
  const renderPushCode = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="branch">Target Branch</Label>
        <Select defaultValue="main">
          <SelectTrigger data-testid="select-push-branch">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="main">main</SelectItem>
            <SelectItem value="develop">develop</SelectItem>
            <SelectItem value="feature/new-ui">feature/new-ui</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="commit-message">Commit Message</Label>
        <Textarea
          id="commit-message"
          placeholder="feat: add new feature"
          className="h-24"
          data-testid="textarea-commit-message"
        />
      </div>
      <div className="p-4 border rounded-lg bg-muted/50 space-y-2">
        <div className="text-sm font-medium mb-2">Changed Files (5)</div>
        {["src/components/Header.tsx", "src/pages/Dashboard.tsx", "src/lib/api.ts", "package.json", "README.md"].map((file, idx) => (
          <div key={idx} className="text-sm text-muted-foreground" data-testid={`changed-file-${idx}`}>
            + {file}
          </div>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => {
          toast({ title: "Code Pushed", description: "Changes pushed to remote repository successfully!" });
          onOpenChange(false);
        }} data-testid="button-push">
          <Upload className="mr-2 h-4 w-4" />
          Push Code
        </Button>
      </div>
    </div>
  );

  const renderCreateMR = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="mr-title">Merge Request Title</Label>
        <Input
          id="mr-title"
          placeholder="feat: implement new dashboard"
          data-testid="input-mr-title"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="source-branch">Source Branch</Label>
        <Select defaultValue="feature/dashboard">
          <SelectTrigger data-testid="select-source-branch">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="feature/dashboard">feature/dashboard</SelectItem>
            <SelectItem value="feature/new-ui">feature/new-ui</SelectItem>
            <SelectItem value="bugfix/login">bugfix/login</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="target-branch">Target Branch</Label>
        <Select defaultValue="main">
          <SelectTrigger data-testid="select-target-branch">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="main">main</SelectItem>
            <SelectItem value="develop">develop</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Describe your changes..."
          className="h-32"
          data-testid="textarea-mr-description"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => {
          toast({ title: "MR Created", description: "Merge request created successfully!" });
          onOpenChange(false);
        }} data-testid="button-create-mr">
          <Upload className="mr-2 h-4 w-4" />
          Create MR
        </Button>
      </div>
    </div>
  );

  const renderReviewCode = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Pending Reviews (3)</h3>
        <Badge>Awaiting Review</Badge>
      </div>
      <div className="space-y-3">
        {[
          { id: 1, title: "feat: add authentication", author: "John Doe", changes: "+247 -89" },
          { id: 2, title: "fix: resolve memory leak", author: "Jane Smith", changes: "+12 -8" },
          { id: 3, title: "refactor: optimize database queries", author: "Bob Johnson", changes: "+156 -203" },
        ].map((mr) => (
          <div key={mr.id} className="p-4 border rounded-lg space-y-2" data-testid={`review-${mr.id}`}>
            <div className="font-medium">{mr.title}</div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>by {mr.author}</span>
              <span>{mr.changes}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" data-testid={`button-approve-${mr.id}`}>
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Approve
              </Button>
              <Button size="sm" variant="outline" data-testid={`button-comment-${mr.id}`}>
                <Eye className="mr-1 h-3 w-3" />
                Comment
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Requirements Phase Actions
  const renderCreateTarget = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="target-name">Target Name</Label>
        <Input
          id="target-name"
          placeholder="Q1 2025 Release"
          data-testid="input-target-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="target-type">Target Type</Label>
        <Select defaultValue="epic">
          <SelectTrigger data-testid="select-target-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="epic">Epic</SelectItem>
            <SelectItem value="milestone">Milestone</SelectItem>
            <SelectItem value="objective">Objective</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="target-description">Description</Label>
        <Textarea
          id="target-description"
          placeholder="Describe the target goals..."
          className="h-32"
          data-testid="textarea-target-description"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start-date">Start Date</Label>
          <Input type="date" id="start-date" data-testid="input-start-date" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end-date">End Date</Label>
          <Input type="date" id="end-date" data-testid="input-end-date" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => {
          toast({ title: "Target Created", description: "New target created successfully!" });
          onOpenChange(false);
        }} data-testid="button-create-target">
          Create Target
        </Button>
      </div>
    </div>
  );

  const renderAssignReviewers = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Select Work Item</Label>
        <Select defaultValue="epic-1">
          <SelectTrigger data-testid="select-work-item">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="epic-1">Epic: User Authentication</SelectItem>
            <SelectItem value="story-1">Story: Login Page</SelectItem>
            <SelectItem value="req-1">Requirement: OAuth2 Support</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Available Team Members</Label>
        <div className="space-y-2">
          {["Alice Johnson", "Bob Smith", "Carol Williams", "David Brown"].map((name, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`reviewer-${idx}`}>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                  {name.split(' ').map(n => n[0]).join('')}
                </div>
                <span>{name}</span>
              </div>
              <Button size="sm" variant="outline" data-testid={`button-assign-${idx}`}>
                Assign
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderLinkJira = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="jira-ticket">Jira Ticket ID</Label>
        <Input
          id="jira-ticket"
          placeholder="PROJ-1234"
          data-testid="input-jira-ticket"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="work-item">Link to Work Item</Label>
        <Select defaultValue="epic-1">
          <SelectTrigger data-testid="select-link-work-item">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="epic-1">Epic: User Management</SelectItem>
            <SelectItem value="story-1">Story: Profile Page</SelectItem>
            <SelectItem value="req-1">Requirement: API Integration</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="p-4 border rounded-lg bg-muted/50">
        <div className="text-sm font-medium mb-2">Existing Links</div>
        <div className="space-y-2">
          {["PROJ-789: Authentication Module", "PROJ-456: Dashboard UI"].map((link, idx) => (
            <div key={idx} className="text-sm text-muted-foreground" data-testid={`existing-link-${idx}`}>
              → {link}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => {
          toast({ title: "Jira Linked", description: "Jira ticket linked successfully!" });
          onOpenChange(false);
        }} data-testid="button-link-jira">
          Link Ticket
        </Button>
      </div>
    </div>
  );

  // Design Phase Actions
  const renderReviewDesign = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Design Assets (4)</h3>
        <Badge>Pending Review</Badge>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[
          { name: "Homepage Mockup", type: "Figma", status: "new" },
          { name: "Mobile App UI", type: "Sketch", status: "updated" },
          { name: "Brand Guidelines", type: "PDF", status: "new" },
          { name: "Icon Set", type: "SVG", status: "approved" },
        ].map((asset, idx) => (
          <div key={idx} className="p-4 border rounded-lg space-y-2" data-testid={`design-${idx}`}>
            <div className="font-medium">{asset.name}</div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{asset.type}</span>
              <Badge variant={asset.status === "approved" ? "default" : "secondary"}>
                {asset.status}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" data-testid={`button-preview-design-${idx}`}>
                <Eye className="mr-1 h-3 w-3" />
                Preview
              </Button>
              <Button size="sm" variant="outline" data-testid={`button-approve-design-${idx}`}>
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Approve
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderUploadDiagram = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="diagram-type">Diagram Type</Label>
        <Select defaultValue="architecture">
          <SelectTrigger data-testid="select-diagram-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="architecture">Architecture Diagram</SelectItem>
            <SelectItem value="flowchart">Flowchart</SelectItem>
            <SelectItem value="sequence">Sequence Diagram</SelectItem>
            <SelectItem value="erd">Entity Relationship</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="diagram-name">Diagram Name</Label>
        <Input
          id="diagram-name"
          placeholder="System Architecture v2.0"
          data-testid="input-diagram-name"
        />
      </div>
      <div className="border-2 border-dashed rounded-lg p-8 text-center" data-testid="upload-area">
        <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-2">
          Drag and drop your diagram here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          Supports PNG, JPG, SVG, PDF (Max 10MB)
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => {
          toast({ title: "Diagram Uploaded", description: "Architecture diagram uploaded successfully!" });
          onOpenChange(false);
        }} data-testid="button-upload-diagram">
          <Upload className="mr-2 h-4 w-4" />
          Upload
        </Button>
      </div>
    </div>
  );

  const renderExportFigma = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="figma-project">Figma Project</Label>
        <Select defaultValue="main">
          <SelectTrigger data-testid="select-figma-project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="main">Main Design System</SelectItem>
            <SelectItem value="mobile">Mobile App Designs</SelectItem>
            <SelectItem value="marketing">Marketing Assets</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Export Options</Label>
        <div className="space-y-2">
          {[
            { id: "components", label: "UI Components", checked: true },
            { id: "styles", label: "Color Styles", checked: true },
            { id: "icons", label: "Icon Library", checked: false },
            { id: "typography", label: "Typography", checked: true },
          ].map((option, idx) => (
            <div key={option.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`export-option-${idx}`}>
              <span>{option.label}</span>
              <Switch defaultChecked={option.checked} data-testid={`switch-${option.id}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 border rounded-lg bg-muted/50">
        <div className="text-sm font-medium mb-2">Export Format</div>
        <div className="flex gap-2">
          <Badge>SVG</Badge>
          <Badge>PNG @2x</Badge>
          <Badge>CSS</Badge>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => {
          toast({ title: "Exported to Figma", description: "Design assets exported to Figma successfully!" });
          onOpenChange(false);
        }} data-testid="button-export-figma">
          <Upload className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  );

  // Maintenance Phase Actions
  const renderGotoReports = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {[
          { name: "Performance Report", type: "System", date: "Oct 30, 2024" },
          { name: "Security Audit", type: "Security", date: "Oct 28, 2024" },
          { name: "Uptime Analysis", type: "Availability", date: "Oct 25, 2024" },
          { name: "Error Summary", type: "Errors", date: "Oct 22, 2024" },
        ].map((report, idx) => (
          <div key={idx} className="p-4 border rounded-lg space-y-2" data-testid={`report-${idx}`}>
            <div className="font-medium">{report.name}</div>
            <div className="text-sm text-muted-foreground">{report.type}</div>
            <div className="text-xs text-muted-foreground">{report.date}</div>
            <Button size="sm" variant="outline" className="w-full" data-testid={`button-view-report-${idx}`}>
              <FileText className="mr-1 h-3 w-3" />
              View Report
            </Button>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => {
          toast({ title: "Reports Dashboard", description: "Opening full reports dashboard..." });
          onOpenChange(false);
        }} data-testid="button-open-reports">
          View All Reports
        </Button>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (actionType) {
      case "run-cicd":
        return renderRunCICD();
      case "view-test-report":
        return renderTestReport();
      case "publish-package":
        return renderPublishPackage();
      case "trigger-release":
        return renderTriggerRelease();
      case "manage-feature-flags":
        return renderFeatureFlags();
      case "open-monitoring":
        return renderMonitoring();
      case "push-code":
        return renderPushCode();
      case "create-mr":
        return renderCreateMR();
      case "review-code":
        return renderReviewCode();
      case "create-target":
        return renderCreateTarget();
      case "assign-reviewers":
        return renderAssignReviewers();
      case "link-jira":
        return renderLinkJira();
      case "review-design":
        return renderReviewDesign();
      case "upload-diagram":
        return renderUploadDiagram();
      case "export-figma":
        return renderExportFigma();
      case "goto-reports":
        return renderGotoReports();
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-cicd-action">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">{getDialogTitle()}</DialogTitle>
          <DialogDescription data-testid="text-dialog-description">
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">{renderContent()}</div>
      </DialogContent>
    </Dialog>
  );
}
