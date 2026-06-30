import { Button } from "@/components/ui/button";
import { RepoCard } from "@/components/repo-card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Info, GitBranch, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { GoldenReposSkeleton } from "@/components/ui/page-skeletons";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import type { GoldenRepository } from "@shared/schema";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { useDebounce } from "@/hooks/use-debounce";
import { DomainNav } from "@/components/domain-nav";
import { useDomain, DOMAIN_CONFIG } from "@/contexts/domain-context";
import { useSDLCProject } from "@/context/sdlc-project-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";

interface GoldenRepoOrganization {
  id: string;
  name: string;
  organizationUrl: string;
  projectName: string;
  repositoryName: string;
  apiVersion: string;
  patToken?: string;
  patConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

type GoldenRepoCardWithChunksProps = {
  repo: any;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onFork: () => void;
  onDownload: () => void;
};

function GoldenRepoCardWithChunks({
  repo,
  isSelected,
  onSelect,
  onPreview,
  onFork,
  onDownload,
}: GoldenRepoCardWithChunksProps) {
  const isGitHub = repo.provider === "github";
  const isGitLab = repo.provider === "gitlab";
  const ghOwner = repo.url ? new URL(repo.url).pathname.split("/")[1] || "" : "";
  const ghRepoName = repo.url ? new URL(repo.url).pathname.split("/")[2] || repo.name : repo.name;
  const defaultBranch = repo.defaultBranch || "main";

  const treeUrl = isGitHub
    ? `/api/github/repository/${encodeURIComponent(ghOwner)}/${encodeURIComponent(ghRepoName)}/tree?branch=${encodeURIComponent(defaultBranch)}`
    : isGitLab
      ? `/api/gitlab/repository/${encodeURIComponent(repo.id)}/tree?branch=${encodeURIComponent(defaultBranch)}&isGoldenRepo=true`
      : `/api/ado/repository/${repo.id}/tree`;

  const treeQueryKey = isGitHub
    ? ["/api/github/repository", ghOwner, ghRepoName, "tree", defaultBranch]
    : isGitLab
      ? ["/api/gitlab/repository", repo.id, "tree", defaultBranch]
      : ["/api/ado/repository", repo.id, "tree"];

  const { data: treeData, isLoading: isTreeLoading } = useQuery({
    queryKey: treeQueryKey,
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(treeUrl),
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch repository tree");
      }
      return response.json();
    },
  });

  let totalFileCount: number | undefined;
  let chunkedCount: number | undefined;

  if (treeData && treeData.tree) {
    const tree = treeData.tree as any[];
    const collectFilePaths = (nodes: any[]): string[] => {
      const paths: string[] = [];
      const walk = (node: any) => {
        if (!node) return;
        const rawPath = String(node.path || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");

        const lower = rawPath.toLowerCase();
        // Exclude Starter Code (same rule as backend)
        if (
          lower.startsWith("starter_code/") ||
          lower.startsWith("starter code/")
        ) {
          return;
        }

        if (node.type === "file") {
          paths.push(rawPath);
        }
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach(walk);
        }
      };
      nodes.forEach(walk);
      return paths;
    };

    const filePathsInTree = collectFilePaths(tree);
    totalFileCount = filePathsInTree.length;
    const chunkedPaths: string[] = treeData.chunkedPaths || [];
    chunkedCount = chunkedPaths.length;
  }

  const [isChunkAllPending, setIsChunkAllPending] = useState(false);
  const [chunkAllLabel, setChunkAllLabel] = useState<string | undefined>(undefined);

  const { toast } = useToast();

  const handleChunkAll = async () => {
    if (!totalFileCount || totalFileCount <= 0) return;
    if (!treeData || !treeData.tree) return;

    const tree = treeData.tree as any[];
    const collectFilePaths = (nodes: any[]): string[] => {
      const paths: string[] = [];
      const walk = (node: any) => {
        if (!node) return;
        const rawPath = String(node.path || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");
        const lower = rawPath.toLowerCase();
        if (
          lower.startsWith("starter_code/") ||
          lower.startsWith("starter code/")
        ) {
          return;
        }
        if (node.type === "file") {
          paths.push(rawPath);
        }
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach(walk);
        }
      };
      nodes.forEach(walk);
      return paths;
    };

    const filePaths = collectFilePaths(tree);
    if (!filePaths.length) return;

    setIsChunkAllPending(true);
    const startedAt = Date.now();
    let completed = 0;
    let skipped = 0;

    try {
      for (const path of filePaths) {
        try {
          const response = await fetch(
            getApiUrl(`/api/golden-repo/${repo.id}/chunk`),
            {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ filePath: path }),
            },
          );
          const result = await response.json();
          if (!response.ok || !result.success) {
            skipped++;
          } else {
            completed++;
          }
        } catch {
          skipped++;
        }

        const elapsedSec = (Date.now() - startedAt) / 1000;
        setChunkAllLabel(
          `Chunking ${completed}/${filePaths.length} (${elapsedSec.toFixed(
            1,
          )}s)`,
        );
      }

      toast({
        title: "Chunk all complete",
        description: `Chunked ${completed} file(s), skipped ${skipped}.`,
      });

      queryClient.invalidateQueries({ queryKey: treeQueryKey });
    } catch (error) {
      console.error("[GoldenRepos] Chunk-all error:", error);
      toast({
        title: "Chunk all failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to chunk all files. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsChunkAllPending(false);
      setChunkAllLabel(undefined);
    }
  };

  return (
    <label className="cursor-pointer flex items-stretch gap-3 min-w-0">
      <RadioGroupItem
        value={repo.id}
        className="mt-4 shrink-0"
        data-testid={`radio-repo-${repo.name.toLowerCase().replace(/\s+/g, "-")}`}
      />
      <div className="flex-1 min-w-0 h-full">
        <RepoCard
          id={repo.id}
          name={repo.name}
          description={repo.description}
          technologies={repo.technologies || []}
          domain={repo.domain || "general"}
          commitCount={repo.commitCount || 0}
          contributors={repo.contributors || []}
          contributorCount={repo.contributorCount || 0}
          lastCommit={repo.lastCommit}
          chunkedCount={chunkedCount}
          totalFileCount={totalFileCount}
          chunkStatusLoading={isTreeLoading || isChunkAllPending}
          isSelected={isSelected}
          onSelect={onSelect}
          onPreview={onPreview}
          onFork={onFork}
          onDownload={onDownload}
          onChunkAll={
            totalFileCount && totalFileCount > 0 ? handleChunkAll : undefined
          }
          chunkAllLabel={chunkAllLabel}
        />
      </div>
    </label>
  );
}

export default function GoldenRepos() {
  const { data: me } = useMe();
  const canCreateProject = me?.canCreateProject ?? false;
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { selectedDomain, setSelectedDomain } = useDomain();
  const { projectConfig, setProjectConfig } = useSDLCProject();
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [forkingRepo, setForkingRepo] = useState<any>(null);
  const [forkTargetOrgUrl, setForkTargetOrgUrl] = useState("");
  const [forkTargetProject, setForkTargetProject] = useState("");
  const [forkNewRepoName, setForkNewRepoName] = useState("");
  const [forkDescription, setForkDescription] = useState("");
  const [forkPat, setForkPat] = useState("");
  const [forkBranch, setForkBranch] = useState("");
  const [forkIncludePermissions, setForkIncludePermissions] = useState(false);
  const [forkMode, setForkMode] = useState<"same-org" | "cross-org">(
    "same-org",
  );
  const [sourcePat, setSourcePat] = useState("");
  const [isForkSubmitting, setIsForkSubmitting] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Golden repos uses "All Domains" only (per-domain tabs disabled in DomainNav)
  useEffect(() => {
    if (selectedDomain !== "all") {
      setSelectedDomain("all");
    }
  }, [selectedDomain, setSelectedDomain]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, selectedDomain, pageSize]);

  const queryParams = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    domain: "all",
  });
  if (debouncedSearchQuery) {
    queryParams.append("search", debouncedSearchQuery);
  }

  const { data: unifiedData, isLoading, isFetching } = useQuery({
    queryKey: ["/api/golden-repositories", page, pageSize, debouncedSearchQuery, "all"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/golden-repositories?${queryParams.toString()}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch golden repositories");
      return response.json();
    },
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  const repos = useMemo(() => {
    return (unifiedData?.repositories || []).map((r: any) => ({
      ...r,
      provider: r.provider || "ado",
    }));
  }, [unifiedData]);
  const totalCount = unifiedData?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, totalCount);
  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  const { data: goldenRepoOrgsData } = useQuery<{
    organizations: GoldenRepoOrganization[];
  }>({
    queryKey: ["/api/golden-repo-organizations"],
  });

  const goldenRepoOrgs = goldenRepoOrgsData?.organizations || [];

  const filteredRepos = repos;

  // Create SDLC project mutation
  const createProjectMutation = useMutation({
    mutationFn: async (data: {
      repositoryIds: string[];
      repositoryName: string;
    }) => {
      const response = await apiRequest(
        "POST",
        "/api/golden-repos/create-sdlc-project",
        data,
      );
      return response.json();
    },
    onSuccess: async (project, variables) => {
      // Fetch Azure DevOps settings
      try {
        const adoResponse = await fetch(getApiUrl("/api/ado-settings"), {
          credentials: "include",
        });
        const adoSettings = await adoResponse.json();

        // Store configuration in SDLC Project context
        setProjectConfig({
          repositoryId: variables.repositoryIds[0],
          repositoryName: variables.repositoryName,
          azureOrganizationUrl: adoSettings.organizationUrl || "",
          azureProjectName: adoSettings.projectName || "",
          azureApiVersion: adoSettings.apiVersion || "7.0",
          isPatConfigured: adoSettings.patConfigured || false,
          sdlcProjectId: project.id,
          sdlcProjectName: project.name,
          createdAt: new Date().toISOString(),
        });

        toast({
          title: "SDLC Project Created",
          description:
            "Successfully created SDLC project with Azure DevOps configuration.",
        });

        setSelectedRepo(null);
        setLocation(`/sdlc?projectId=${project.id}`);
      } catch (error) {
        toast({
          title: "Warning",
          description:
            "SDLC project created but Azure DevOps configuration could not be loaded.",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create SDLC project. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleRepoSelect = (id: string) => {
    setSelectedRepo(id);
  };

  const handleCreateProject = async () => {
    if (!selectedRepo) return;
    const repo = repos.find((r: any) => r.id === selectedRepo);
    if (!repo) return;

    const isGitHubRepo = repo.provider === "github";

    if (isGitHubRepo) {
      const parts = repo.url ? new URL(repo.url).pathname.split("/").filter(Boolean) : [];
      const params = new URLSearchParams({
        fromGoldenRepo: "true",
        repoId: selectedRepo,
        repoName: repo.name || "",
        provider: "github",
        githubOwner: parts[0] || "",
        githubRepoName: parts[1] || repo.name || "",
      });
      setLocation(`/projects?${params.toString()}`);
      return;
    }

    if (repo.provider === "gitlab") {
      const params = new URLSearchParams({
        fromGoldenRepo: "true",
        repoId: selectedRepo,
        repoName: repo.name || "",
        provider: "gitlab",
        gitlabProjectId: repo.id,
      });
      setLocation(`/projects?${params.toString()}`);
      return;
    }

    try {
      const adoResponse = await fetch(getApiUrl("/api/ado-settings"), {
        credentials: "include",
      });
      const adoSettings = await adoResponse.json();

      const orgsResponse = await fetch(
        getApiUrl("/api/artifact-organizations"),
        { credentials: "include" },
      );
      const orgsData = await orgsResponse.json();
      const artifactOrgs = orgsData?.organizations || [];

      const matchingOrg =
        artifactOrgs.find(
          (org: any) =>
            org.projectName === adoSettings.projectName ||
            org.organizationUrl === adoSettings.organizationUrl,
        ) || artifactOrgs[0];

      const params = new URLSearchParams({
        fromGoldenRepo: "true",
        repoId: selectedRepo,
        repoName: repo.name || "",
        orgId: matchingOrg?.id || "",
        orgName: matchingOrg?.projectName || adoSettings.projectName || "",
        orgUrl:
          matchingOrg?.organizationUrl || adoSettings.organizationUrl || "",
      });

      setLocation(`/projects?${params.toString()}`);
    } catch (error) {
      const params = new URLSearchParams({
        fromGoldenRepo: "true",
        repoId: selectedRepo,
        repoName: repo.name || "",
      });
      setLocation(`/projects?${params.toString()}`);
    }
  };

  const handlePreview = (repoId: string) => {
    const repo = repos.find((r: any) => r.id === repoId);
    const provider = repo?.provider || "ado";
    const params = new URLSearchParams({ repoId, provider });
    if (projectConfig?.sdlcProjectId) {
      params.set("projectId", String(projectConfig.sdlcProjectId));
    }
    if (provider === "github" && repo?.url) {
      const parts = new URL(repo.url).pathname.split("/").filter(Boolean);
      params.set("owner", parts[0] || "");
      params.set("name", parts[1] || repo.name);
    } else if (provider === "gitlab") {
      params.set("name", repo?.name || "");
    } else {
      params.set("name", repo?.name || "");
    }
    setLocation(`/golden-repos/preview?${params.toString()}`);
  };

  const handleFork = (repoId: string) => {
    const repo = repos.find((r: any) => r.id === repoId);
    if (!repo) return;

    setForkingRepo(repo);
    // Use only the last segment after "/" to avoid invalid namespace-slash in GitLab/GitHub names
    const shortRepoName = (repo.name || "").split("/").pop() || repo.name;
    setForkNewRepoName(`${shortRepoName}-fork`);
    setForkDescription(`Forked from ${repo.name} for testing or feature development.`);
    setForkBranch("");
    setForkIncludePermissions(false);
    setConnectionTestResult(null);

    if (repo.provider === "ado") {
      const defaultGoldenRepoOrg = goldenRepoOrgs[0];
      setForkMode("same-org");
      setForkTargetOrgUrl(defaultGoldenRepoOrg?.organizationUrl || "");
      setForkTargetProject(defaultGoldenRepoOrg?.projectName || "");
      setForkPat("");
    } else if (repo.provider === "gitlab") {
      // For GitLab, forkTargetProject is reused as "namespace path" (group or user)
      setForkMode("same-org");
      setForkTargetOrgUrl("");
      setForkTargetProject("");
      setForkPat("");
    } else if (repo.provider === "github") {
      // For GitHub, forkTargetProject is reused as "organization" (optional)
      setForkMode("same-org");
      setForkTargetOrgUrl("");
      setForkTargetProject("");
      setForkPat("");
    }

    setForkDialogOpen(true);
  };

  const handleTestConnection = async () => {
    if (
      !forkTargetOrgUrl.trim() ||
      !forkTargetProject.trim() ||
      (forkMode === "cross-org" && !forkPat.trim())
    ) {
      toast({
        title: "Validation Error",
        description:
          "Organization URL, Project Name, and PAT are required for testing",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsTestingConnection(true);
      setConnectionTestResult(null);

      const response = await fetch(getApiUrl("/api/ado/test-connection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          organizationUrl: forkTargetOrgUrl.trim(),
          projectName: forkTargetProject.trim(),
          pat: forkPat,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setConnectionTestResult({
          success: true,
          message:
            "Connection successful! You have access to the target project.",
        });
        toast({
          title: "Connection Successful",
          description: "Successfully connected to Azure DevOps project",
        });
      } else {
        const errorMessage = result.details
          ? `${result.error}\n\n${result.details}`
          : result.error || "Failed to connect to Azure DevOps";
        setConnectionTestResult({
          success: false,
          message: errorMessage,
        });
        toast({
          title: "Connection Failed",
          description: result.error || "Failed to connect to Azure DevOps",
          variant: "destructive",
        });
      }
    } catch (error) {
      setConnectionTestResult({
        success: false,
        message: "Network error while testing connection",
      });
      toast({
        title: "Connection Test Failed",
        description: "Network error while testing connection",
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleForkSubmit = async () => {
    if (!forkingRepo || !forkNewRepoName.trim()) {
      toast({
        title: "Validation Error",
        description: "Repository name is required",
        variant: "destructive",
      });
      return;
    }

    const provider = forkingRepo.provider as string;

    try {
      setIsForkSubmitting(true);

      if (provider === "gitlab") {
        const response = await fetch(getApiUrl("/api/gitlab/fork-repository"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            sourceProjectId: forkingRepo.id,
            namespacePath: forkTargetProject.trim() || undefined,
            newName: forkNewRepoName.trim(),
            // GitLab path: only letters, digits, _, -, . — no slashes or spaces
            newPath: forkNewRepoName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, ""),
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Failed to fork GitLab repository");
        toast({
          title: "Repository Forked",
          description: `Successfully forked to ${result.webUrl || forkNewRepoName}`,
        });
        setForkDialogOpen(false);
        handleForkCancel();
        return;
      }

      if (provider === "github") {
        const ghParts = forkingRepo.url ? new URL(forkingRepo.url).pathname.split("/").filter(Boolean) : [];
        const ghOwnerParam = ghParts[0] || "";
        const ghRepoParam = ghParts[1] || forkingRepo.name;
        const response = await fetch(getApiUrl("/api/github/fork-repository"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            owner: ghOwnerParam,
            repo: ghRepoParam,
            organization: forkTargetProject.trim() || undefined,
            newName: forkNewRepoName.trim(),
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Failed to fork GitHub repository");
        toast({
          title: "Repository Forked",
          description: `Successfully forked to ${result.webUrl || forkNewRepoName}`,
        });
        setForkDialogOpen(false);
        handleForkCancel();
        return;
      }

      // ADO fork
      if (
        !forkTargetOrgUrl.trim() ||
        !forkTargetProject.trim() ||
        (forkMode === "cross-org" && !forkPat.trim())
      ) {
        toast({
          title: "Validation Error",
          description: "Organization URL, Project Name, and PAT are required",
          variant: "destructive",
        });
        setIsForkSubmitting(false);
        return;
      }

      const response = await fetch(getApiUrl("/api/ado/fork-repository"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourceRepoId: forkingRepo.id,
          targetOrgUrl: forkTargetOrgUrl.trim(),
          targetProjectName: forkTargetProject.trim(),
          newRepoName: forkNewRepoName.trim(),
          description: forkDescription.trim(),
          pat: forkMode === "cross-org" ? forkPat : undefined,
          branch: forkBranch.trim() || undefined,
          includePermissions: forkIncludePermissions,
          forkMode,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: "Repository Forked",
          description: `Successfully forked repository to ${forkTargetProject}/${forkNewRepoName}`,
        });
        setForkDialogOpen(false);
        handleForkCancel();
      } else {
        throw new Error(result.error || "Failed to fork repository");
      }
    } catch (error) {
      toast({
        title: "Fork Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to fork repository. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsForkSubmitting(false);
    }
  };

  const handleForkCancel = () => {
    setForkDialogOpen(false);
    setForkingRepo(null);
    setForkTargetOrgUrl("https://dev.azure.com/DevXPlatform/");
    setForkTargetProject("");
    setForkNewRepoName("");
    setForkDescription("");
    setForkPat("");
    setForkBranch("");
    setForkIncludePermissions(false);
    setConnectionTestResult(null);
    setForkMode("same-org");
    setSourcePat("");
  };

  const handleDownload = async (repoId: string) => {
    try {
      const repo = repos.find((r: any) => r.id === repoId);
      if (!repo) return;

      let downloadUrl: string;
      if (repo.provider === "github" && repo.url) {
        const parts = new URL(repo.url).pathname.split("/").filter(Boolean);
        const owner = parts[0] || "";
        const name = parts[1] || repo.name;
        downloadUrl = `/api/github/repository/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/download`;
      } else if (repo.provider === "gitlab") {
        downloadUrl = `/api/gitlab/repository/${encodeURIComponent(repoId)}/download${repo.defaultBranch ? `?branch=${encodeURIComponent(repo.defaultBranch)}` : ""}`;
      } else {
        downloadUrl = `/api/ado/repository/${repoId}/download`;
      }

      const response = await fetch(
        getApiUrl(downloadUrl),
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to download repository: ${response.status} ${response.statusText}`,
        );
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = `${repo.name || "repository"}.zip`;
      if (contentDisposition) {
        const matches = /filename="?([^"]+)"?/.exec(contentDisposition);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }

      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Download Started",
        description: `Downloading ${filename}`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to download repository. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <GoldenReposSkeleton />;
  }

  const domainConfig = DOMAIN_CONFIG.all;

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b p-6">
        <PageHeader
          icon={GitBranch}
          title="Golden Repositories"
          subtitle="Browse and select template repositories across all domains"
          color="emerald"
          data-testid="heading-golden-repos"
        >
          <Badge
            className={`${domainConfig.bgColor} ${domainConfig.textColor} border-0`}
          >
            {domainConfig.label}
          </Badge>
          {selectedRepo && canCreateProject && (
            <Button
              data-testid="button-confirm-selection"
              onClick={handleCreateProject}
              disabled={createProjectMutation.isPending}
            >
              {createProjectMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating Project...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          )}
        </PageHeader>
      </div>

      <DomainNav />

      <div className="flex-1 space-y-6 p-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search repositories..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-repos"
          />
        </div>

        {/* Pagination Controls */}
        <div className="mt-2 flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground" aria-live="polite">
            Showing <span className="font-semibold text-foreground">{pageStart}</span>-<span className="font-semibold text-foreground">{pageEnd}</span> of <span className="font-semibold text-foreground">{totalCount}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="golden-repos-page-size" className="text-xs text-muted-foreground">
                Rows
              </Label>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => setPageSize(Number(value))}
              >
                <SelectTrigger id="golden-repos-page-size" className="h-9 w-20" data-testid="select-golden-repos-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex h-9 items-center rounded-md border border-border bg-background">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Previous golden repositories page"
                disabled={!canGoPrevious}
                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                data-testid="button-golden-repos-previous-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-20 px-2 text-center text-sm">
                <span className="font-medium text-foreground">{page}</span>
                <span className="text-muted-foreground"> / {totalPages}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Next golden repositories page"
                disabled={!canGoNext}
                onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                data-testid="button-golden-repos-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <RadioGroup
          value={selectedRepo || ""}
          onValueChange={setSelectedRepo}
          className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {filteredRepos.map((repo: any) => (
            <GoldenRepoCardWithChunks
              key={repo.id}
              repo={repo}
              isSelected={selectedRepo === repo.id}
              onSelect={() => handleRepoSelect(repo.id)}
              onPreview={() => handlePreview(repo.id)}
              onFork={() => handleFork(repo.id)}
              onDownload={() => handleDownload(repo.id)}
            />
          ))}
        </RadioGroup>

      </div>

      {/* Fork Dialog */}
      <Dialog open={forkDialogOpen} onOpenChange={setForkDialogOpen}>
        <DialogContent
          className="sm:max-w-[600px] max-h-[90vh] flex flex-col p-0"
          data-testid="dialog-fork-repo"
        >
          <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
            <DialogTitle>Fork Repository</DialogTitle>
            <DialogDescription>
              {forkingRepo?.provider === "gitlab"
                ? `Fork ${forkingRepo?.name} to a new GitLab repository. Enter the target namespace below.`
                : forkingRepo?.provider === "github"
                  ? `Fork ${forkingRepo?.name} to a new GitHub repository. Optionally specify a target organization.`
                  : `Fork ${forkingRepo?.name} to a new Azure DevOps repository. Enter the target configuration below.`}
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable Content Area */}
          <div
            className="flex-1 overflow-y-auto px-6 pb-4 scroll-smooth scrollbar-thin focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            tabIndex={0}
            role="region"
            aria-label="Fork repository form content"
          >
            <div className="space-y-4 py-2">
              {/* GitLab fork fields */}
              {forkingRepo?.provider === "gitlab" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="fork-project" data-testid="label-target-project">
                      Target Namespace (Optional)
                    </Label>
                    <Input
                      id="fork-project"
                      placeholder="e.g. my-group or my-username"
                      value={forkTargetProject}
                      onChange={(e) => setForkTargetProject(e.target.value)}
                      data-testid="input-target-project"
                    />
                    <p className="text-xs text-muted-foreground">
                      GitLab group or user namespace to fork into. Leave empty to fork into your personal namespace.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fork-repo-name" data-testid="label-repo-name">
                      New Repository Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="fork-repo-name"
                      placeholder="Enter new repository name"
                      value={forkNewRepoName}
                      onChange={(e) => setForkNewRepoName(e.target.value)}
                      data-testid="input-repo-name"
                    />
                  </div>
                </>
              )}

              {/* GitHub fork fields */}
              {forkingRepo?.provider === "github" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="fork-project" data-testid="label-target-project">
                      Target Organization (Optional)
                    </Label>
                    <Input
                      id="fork-project"
                      placeholder="e.g. my-org (leave empty to fork to your account)"
                      value={forkTargetProject}
                      onChange={(e) => setForkTargetProject(e.target.value)}
                      data-testid="input-target-project"
                    />
                    <p className="text-xs text-muted-foreground">
                      GitHub organization to fork into. Leave empty to fork into your personal account.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fork-repo-name" data-testid="label-repo-name">
                      New Repository Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="fork-repo-name"
                      placeholder="Enter new repository name"
                      value={forkNewRepoName}
                      onChange={(e) => setForkNewRepoName(e.target.value)}
                      data-testid="input-repo-name"
                    />
                    <p className="text-xs text-muted-foreground">
                      Custom name for the forked repository.
                    </p>
                  </div>
                </>
              )}

              {/* ADO fork fields */}
              {(!forkingRepo?.provider || forkingRepo?.provider === "ado") && (
                <>
                  {/* Fork Mode */}
                  <div className="space-y-2">
                    <Label data-testid="label-fork-mode">Fork Mode</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={forkMode === "same-org" ? "default" : "outline"}
                        onClick={() => {
                          const defaultGoldenRepoOrg = goldenRepoOrgs[0];
                          setForkMode("same-org");
                          setForkTargetOrgUrl(defaultGoldenRepoOrg?.organizationUrl || "");
                          setForkTargetProject(defaultGoldenRepoOrg?.projectName || "");
                          setForkPat("");
                        }}
                        data-testid="button-fork-mode-same-org"
                      >
                        Same organization
                      </Button>
                      <Button
                        type="button"
                        variant={forkMode === "cross-org" ? "default" : "outline"}
                        onClick={() => {
                          setForkMode("cross-org");
                          setForkTargetOrgUrl("");
                          setForkTargetProject("");
                          setForkPat("");
                        }}
                        data-testid="button-fork-mode-cross-org"
                      >
                        Cross organization
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {forkMode === "same-org"
                        ? "Fork within the same Azure DevOps organization using native fork API."
                        : "Creates a new repository in the target organization and imports content from the source using Git import. Requires a PAT for the source organization."}
                    </p>
                  </div>

                  {/* Target Organization URL */}
                  <div className="space-y-2">
                    <Label htmlFor="fork-org-url" data-testid="label-org-url">
                      Target Organization URL (write) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="fork-org-url"
                      placeholder="https://dev.azure.com/YourTargetOrg/"
                      value={forkTargetOrgUrl}
                      onChange={(e) => setForkTargetOrgUrl(e.target.value)}
                      data-testid="input-org-url"
                    />
                    <p className="text-xs text-muted-foreground">
                      The URL of the Azure DevOps organization where the new repository will be created.
                    </p>
                  </div>

                  {/* Target Project Name */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="fork-project" data-testid="label-target-project">
                        Target Project Name (write) <span className="text-destructive">*</span>
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="You can give a newly created project name from the same organization"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      id="fork-project"
                      placeholder="Enter target project name"
                      value={forkTargetProject}
                      onChange={(e) => setForkTargetProject(e.target.value)}
                      data-testid="input-target-project"
                    />
                    <p className="text-xs text-muted-foreground">
                      The project within the target organization where the new repository will reside.
                    </p>
                  </div>

                  {/* New Repository Name */}
                  <div className="space-y-2">
                    <Label htmlFor="fork-repo-name" data-testid="label-repo-name">
                      New Repository Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="fork-repo-name"
                      placeholder="Enter new repository name"
                      value={forkNewRepoName}
                      onChange={(e) => setForkNewRepoName(e.target.value)}
                      data-testid="input-repo-name"
                    />
                    <p className="text-xs text-muted-foreground">
                      The name for the new repository in the target project.
                    </p>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label htmlFor="fork-description" data-testid="label-description">
                      Description (Optional)
                    </Label>
                    <Textarea
                      id="fork-description"
                      placeholder="Forked from NousAugmentedDevX for testing..."
                      value={forkDescription}
                      onChange={(e) => setForkDescription(e.target.value)}
                      rows={2}
                      data-testid="input-description"
                    />
                  </div>

                  {forkMode === "cross-org" && (
                    <div className="space-y-1 pt-2">
                      <div className="text-sm font-medium">Source (read)</div>
                      <p className="text-xs text-muted-foreground">
                        The source is the current organization that hosts the golden repository you selected. No PAT input required; the server uses a configured source PAT.
                      </p>
                    </div>
                  )}

                  <div className="space-y-1 pt-2">
                    <div className="text-sm font-medium">Target (write)</div>
                    <p className="text-xs text-muted-foreground">The target is where the new repository will be created.</p>
                  </div>

                  {/* Target PAT */}
                  <div className="space-y-2">
                    <Label htmlFor="fork-pat" data-testid="label-pat">
                      Target org PAT (write){" "}
                      {forkMode === "cross-org" ? (
                        <span className="text-destructive">*</span>
                      ) : (
                        <span className="text-muted-foreground text-xs font-normal">(optional for same-org)</span>
                      )}
                    </Label>
                    <Input
                      id="fork-pat"
                      type="password"
                      placeholder="Enter your Azure DevOps PAT for the target organization"
                      value={forkPat}
                      onChange={(e) => setForkPat(e.target.value)}
                      data-testid="input-pat"
                      disabled={forkMode === "same-org"}
                    />
                    <p className="text-xs text-muted-foreground">
                      PAT must have Code (Read & Write) permissions for the target organization.
                    </p>
                  </div>

                  {/* Branch Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="fork-branch" data-testid="label-branch">
                      Branch Selection{" "}
                      {forkMode === "cross-org" ? "(Not available for cross-org)" : "(Optional)"}
                    </Label>
                    <Input
                      id="fork-branch"
                      placeholder={forkMode === "cross-org" ? "Git import brings the whole repository" : "Leave empty for default branch"}
                      value={forkBranch}
                      onChange={(e) => setForkBranch(e.target.value)}
                      disabled={forkMode === "cross-org"}
                      data-testid="input-branch"
                    />
                    <p className="text-xs text-muted-foreground">
                      {forkMode === "cross-org"
                        ? "Git import imports the entire repository history. Branch selection is not supported for cross-organization forks."
                        : "Specify a branch to fork only that branch (e.g., main, develop). Leave empty to fork the default branch."}
                    </p>
                  </div>

                  {/* Include Permissions */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="fork-permissions"
                      checked={forkIncludePermissions}
                      onCheckedChange={(checked) => setForkIncludePermissions(checked === true)}
                      data-testid="checkbox-permissions"
                    />
                    <Label htmlFor="fork-permissions" className="text-sm font-normal cursor-pointer" data-testid="label-permissions">
                      Include permissions / security settings (if supported)
                    </Label>
                  </div>
                </>
              )}

              {/* Test Connection Button (ADO only) */}
              {(!forkingRepo?.provider || forkingRepo?.provider === "ado") && forkMode === "cross-org" && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={
                      isTestingConnection ||
                      !forkTargetOrgUrl.trim() ||
                      !forkTargetProject.trim() ||
                      !forkPat.trim()
                    }
                    className="w-full"
                    data-testid="button-test-connection"
                  >
                    {isTestingConnection ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Testing Connection...
                      </>
                    ) : (
                      "Test Connection"
                    )}
                  </Button>
                </div>
              )}

              {/* Connection Test Result */}
              {connectionTestResult && (
                <div
                  className={`flex items-start gap-2 p-3 rounded-md ${
                    connectionTestResult.success
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                  data-testid="connection-test-result"
                >
                  {connectionTestResult.success ? (
                    <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  )}
                  <p className="text-sm whitespace-pre-line">
                    {connectionTestResult.message}
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 pb-6 pt-4 flex-shrink-0 border-t">
            <Button
              variant="outline"
              onClick={handleForkCancel}
              disabled={isForkSubmitting}
              data-testid="button-cancel-fork"
            >
              Cancel
            </Button>
            <Button
              onClick={handleForkSubmit}
              disabled={
                isForkSubmitting ||
                !forkNewRepoName.trim() ||
                ((!forkingRepo?.provider || forkingRepo?.provider === "ado") && (
                  !forkTargetOrgUrl.trim() ||
                  !forkTargetProject.trim() ||
                  (forkMode === "cross-org" && !forkPat.trim())
                ))
              }
              data-testid="button-confirm-fork"
            >
              {isForkSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Forking Repository...
                </>
              ) : (
                "Fork Repository"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
