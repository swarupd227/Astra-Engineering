import { GenericModal } from "@/components/ui/generic-modal";
import { RegenerateModal } from "@/components/regenerate-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  Settings,
  FileCode,
  Archive,
  Shield,
  Package,
  Flag,
  Database,
  Code,
  FolderGit2,
  GitCommit,
  GitMerge,
  Tag,
  Tags,
  Target,
  FileText,
  Clipboard,
  BookOpen,
  Network,
  Palette,
  Figma,
  Globe,
  Container,
  Server,
  MonitorDot,
  AlertCircle,
  Bell,
  Zap,
  TrendingUp,
  Plus,
  Edit,
  Trash2,
  Search,
  Download,
  Eye,
  Rocket,
  Users,
  Calendar,
  BarChart3,
  Activity,
  Upload,
  RefreshCw,
  UserCheck,
  ExternalLink,
  Save,
  Loader2,
  Cloud,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Sparkles,
  Bot,
  UserCircle,
  Link as LinkIcon,
  Unlink,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { pollAsyncJob } from "@/lib/async-job-poller";
import { getApiUrl } from "@/lib/api-config";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { WorkItemDetailsDialog } from "@/components/work-item-details-dialog";
import { WorkItemEditDialog } from "@/components/work-item-edit-dialog";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// Helper to render a small initial for work item types
const getWorkItemTypeInitial = (type: string): string => {
  switch (type) {
    case "User Story":
      return "S";
    case "Epic":
      return "E";
    case "Feature":
      return "F";
    case "Task":
      return "T";
    case "Bug":
      return "B";
    case "Issue":
      return "I";
    case "Test Case":
      return "TC";
    default:
      return type?.charAt(0)?.toUpperCase() || "?";
  }
};

// Helper to get icon color classes based on work item type
const getWorkItemIconColors = (type: string): string => {
  switch (type) {
    case "Epic":
      return "bg-purple-500 text-white";
    case "Feature":
      return "bg-blue-500 text-white";
    case "User Story":
      return "bg-green-500 text-white";
    case "Task":
      return "bg-orange-500 text-white";
    case "Bug":
      return "bg-red-500 text-white";
    case "Issue":
      return "bg-yellow-500 text-white";
    case "Test Case":
      return "bg-teal-500 text-white";
    default:
      return "bg-muted text-foreground";
  }
};

type FeatureType =
  // Build & Testing
  | "pipelines"
  | "jobs"
  | "pipeline-editor"
  | "artifacts"
  | "security-config"
  // Deployment
  | "releases"
  | "feature-flags"
  | "package-registry"
  | "model-registry"
  // Development
  | "code"
  | "repository"
  | "branches"
  | "commits"
  | "merge-requests"
  | "tags"
  | "preview"
  | "review-code"
  // Design
  | "system-architecture"
  | "database-design"
  | "ui-ux-design"
  | "component-design"
  | "snippets"
  | "repository-graph"
  | "design-merge-requests"
  | "design-assets"
  | "figma-link"
  | "review-design"
  // Maintenance
  | "environments"
  | "kubernetes-clusters"
  | "terraform-states"
  | "monitor"
  | "error-tracking"
  | "alerts"
  | "incidents"
  | "value-stream-analytics"
  // Requirements & Analysis
  | "epics"
  | "user-stories"
  | "requirements"
  | "backlog"
  | "documentation";

interface PhaseFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureType: FeatureType | null;
  projectId: string;
  dbProjectId?: string;
  projectName: string;
  phaseName: string;
  phaseNumber: number;
  artifactOrgId?: string;
  organizationUrl?: string;
  adoProjectId?: string;
  integrationType?: string;
}

export function PhaseFeatureDialog({
  open,
  onOpenChange,
  featureType,
  projectId,
  dbProjectId,
  projectName,
  phaseName,
  phaseNumber,
  artifactOrgId,
  organizationUrl,
  adoProjectId,
  integrationType = "ado",
}: PhaseFeatureDialogProps) {
  const { toast } = useToast();

  // If dialog is opened without a project selection, notify once and close it
  useEffect(() => {
    if (open && !projectId) {
      toast({
        title: "Selection Required",
        description: "Please select a project before using features.",
        variant: "destructive",
      });
      onOpenChange(false);
    }
  }, [open, projectId, toast, onOpenChange]);

  const [searchQuery, setSearchQuery] = useState("");
  const [createNewDialogOpen, setCreateNewDialogOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset fullscreen state when feature type changes
  useEffect(() => {
    setIsFullscreen(false);
  }, [featureType]);

  if (!featureType) return null;

  const getDialogTitle = () => {
    const titles: Record<FeatureType, string> = {
      // Build & Testing
      pipelines: "CI/CD Pipelines",
      jobs: "Pipeline Jobs",
      "pipeline-editor": "Pipeline Editor",
      artifacts: "Build Artifacts",
      "security-config": "Security Configuration",
      // Deployment
      releases: "Releases",
      "feature-flags": "Feature Flags",
      "package-registry": "Package Registry",
      "model-registry": "Model Registry",
      // Development
      code: "Code Browser",
      repository: "Repository",
      branches: "Branches",
      commits: "Commits",
      "merge-requests": "Merge Requests",
      tags: "Tags",
      preview: "Local Preview",
      "review-code": "Code Review",
      // Design
      "system-architecture": "System Architecture",
      "database-design": "Database Design",
      "ui-ux-design": "UI/UX Design",
      "component-design": "Component Design",
      snippets: "Code Snippets",
      "repository-graph": "Repository Graph",
      "design-merge-requests": "Design Merge Requests",
      "design-assets": "Design Assets",
      "figma-link": "Figma Integration",
      "review-design": "Design Review",
      // Maintenance
      environments: "Environments",
      "kubernetes-clusters": "Kubernetes Clusters",
      "terraform-states": "Terraform States",
      monitor: "Monitoring",
      "error-tracking": "Error Tracking",
      alerts: "Alerts",
      incidents: "Incidents",
      "value-stream-analytics": "Value Stream Analytics",
      // Requirements & Analysis
      epics: "Epics",
      "user-stories": "Work Items",
      requirements: "Requirements",
      backlog: "Backlog",
      documentation: "Documentation",
    };
    return titles[featureType];
  };


  const renderContent = () => {
    switch (featureType) {
      // BUILD & TESTING PHASE
      case "pipelines":
        return (
          <PipelinesContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "jobs":
        return (
          <JobsContent projectName={projectName} searchQuery={searchQuery} />
        );
      case "pipeline-editor":
        return <PipelineEditorContent projectName={projectName} />;
      case "artifacts":
        return (
          <ArtifactsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "security-config":
        return <SecurityConfigContent projectName={projectName} />;

      // DEPLOYMENT PHASE
      case "releases":
        return (
          <ReleasesContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "feature-flags":
        return (
          <FeatureFlagsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "package-registry":
        return (
          <PackageRegistryContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "model-registry":
        return (
          <ModelRegistryContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );

      // DEVELOPMENT PHASE
      case "code":
        return (
          <DevelopmentOverviewContent
            projectId={projectId}
            projectName={projectName}
          />
        );
      case "repository":
        return (
          <RepositoryContent
            projectName={projectName}
            projectId={projectId}
            onClose={() => onOpenChange(false)}
          />
        );
      case "branches":
        return (
          <BranchesContent
            projectName={projectName}
            projectId={projectId}
            searchQuery={searchQuery}
          />
        );
      case "commits":
        return (
          <CommitsContent
            projectName={projectName}
            projectId={projectId}
            searchQuery={searchQuery}
          />
        );
      case "merge-requests":
        return (
          <MergeRequestsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "tags":
        return (
          <TagsContent projectName={projectName} searchQuery={searchQuery} />
        );
      case "preview":
        return (
          <PreviewContent projectId={projectId} projectName={projectName} />
        );
      case "review-code":
        return (
          <CodeReviewContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );

      // DESIGN PHASE
      case "system-architecture":
        return (
          <SystemArchitectureContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
          />
        );
      case "database-design":
        return (
          <DatabaseDesignContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
          />
        );
      case "ui-ux-design":
        return (
          <UIUXDesignContent
            projectId={projectId}
            dbProjectId={dbProjectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            artifactOrgId={artifactOrgId}
            organizationUrl={organizationUrl}
            adoProjectId={adoProjectId}
          />
        );
      case "component-design":
        return (
          <ComponentDesignContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
          />
        );
      case "snippets":
        return (
          <SnippetsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "repository-graph":
        return <RepositoryGraphContent projectName={projectName} />;
      case "design-merge-requests":
        return (
          <MergeRequestsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "design-assets":
        return (
          <DesignAssetsContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
          />
        );
      case "figma-link":
        return (
          <FigmaLinkContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
          />
        );
      case "review-design":
        return (
          <DesignReviewContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
          />
        );

      // MAINTENANCE PHASE
      case "environments":
        return (
          <EnvironmentsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "kubernetes-clusters":
        return (
          <KubernetesClustersContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "terraform-states":
        return (
          <TerraformStatesContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "monitor":
        return <MonitorContent projectName={projectName} />;
      case "error-tracking":
        return (
          <ErrorTrackingContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "alerts":
        return (
          <AlertsContent projectName={projectName} searchQuery={searchQuery} />
        );
      case "incidents":
        return (
          <IncidentsContent
            projectName={projectName}
            searchQuery={searchQuery}
          />
        );
      case "value-stream-analytics":
        return <ValueStreamAnalyticsContent projectName={projectName} />;

      // REQUIREMENTS & ANALYSIS PHASE
      case "epics":
        return (
          <EpicsContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
            integrationType={integrationType}
          />
        );
      case "user-stories":
        return (
          <UserStoriesContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
            artifactOrgId={artifactOrgId}
            organizationUrl={organizationUrl}
            integrationType={integrationType}
          />
        );
      case "requirements":
        return (
          <RequirementsContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
            integrationType={integrationType}
          />
        );
      case "backlog":
        return (
          <BacklogContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
            integrationType={integrationType}
          />
        );
      case "documentation":
        return (
          <DocumentationContent
            projectId={projectId}
            projectName={projectName}
            phaseNumber={phaseNumber}
            searchQuery={searchQuery}
          />
        );

      default:
        return <div className="p-6">Feature coming soon...</div>;
    }
  };

  const showSearch = ![
    "pipeline-editor",
    "repository",
    "repository-graph",
    "figma-link",
    "monitor",
    "value-stream-analytics",
    "ui-ux-design",
    "requirements", // No search or filter for Requirements submenu
    "user-stories", // Work Items has its own search in the sticky header
  ].includes(featureType);

  // Show filter button for all items with search EXCEPT documentation (which keeps search but removes filter)
  const showFilter = showSearch && featureType !== "documentation";

  // Only enable fullscreen for user-stories
  const supportsFullscreen = featureType === "user-stories";

  return (
    <>
      <GenericModal
        open={open}
        onOpenChange={onOpenChange}
        title={getDialogTitle()}
        description={projectName || undefined}
        icon={FileText}
        width={isFullscreen ? "100vw" : "95vw"}
        maxHeight={isFullscreen ? "100vh" : "90vh"}
        contentClassName="space-y-4"
      >
        <div className="space-y-4">
        {showSearch && (
          <div className="flex items-center gap-2">
              {supportsFullscreen && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  className="shrink-0"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              )}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-9"
                data-testid="input-search"
              />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear search"
                    data-testid="button-clear-search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
            </div>
          </div>
        )}

          <div>{renderContent()}</div>
        </div>
      </GenericModal>

      {/* Create New Dialog */}
      <Dialog open={createNewDialogOpen} onOpenChange={setCreateNewDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-create-new">
          <DialogHeader>
            <DialogTitle>Create New {getDialogTitle()}</DialogTitle>
          </DialogHeader>
          <CreateNewForm
            featureType={featureType}
            projectName={projectName}
            projectId={projectId}
            phaseNumber={phaseNumber}
            onSuccess={() => {
              setCreateNewDialogOpen(false);
              toast({
                title: "Created Successfully",
                description: `New ${getDialogTitle()} has been created!`,
              });
            }}
            onCancel={() => setCreateNewDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// CREATE NEW FORM COMPONENT
function CreateNewForm({
  featureType,
  projectName,
  projectId,
  phaseNumber,
  onSuccess,
  onCancel,
}: {
  featureType: FeatureType;
  projectName: string;
  projectId: string;
  phaseNumber: number;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("unassigned");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");

  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [fileData, setFileData] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [epicsList, setEpicsList] = useState<any[]>([]);
  const [selectedEpicId, setSelectedEpicId] = useState("");
  const [isFetchingEpics, setIsFetchingEpics] = useState(false);

  const createEpicMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      assignedTo?: string;
      priority: string;
      description: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics`,
        data
      );
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });

      // Check if a phase was unlocked
      if (response?._phaseUnlocked?.unlocked) {
        toast({
          title: "✅ Phase Unlocked!",
          description: `${response._phaseUnlocked.phaseName} — You can now proceed.`,
        });
      }

      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create epic",
        variant: "destructive",
      });
    },
  });

  const createBacklogMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      type: string;
      assignedTo?: string;
      priority: string;
      description: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog`,
        data
      );
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });

      // Check if a phase was unlocked
      if (response?._phaseUnlocked?.unlocked) {
        toast({
          title: "✅ Phase Unlocked!",
          description: `${response._phaseUnlocked.phaseName} — You can now proceed.`,
        });
      }

      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create item",
        variant: "destructive",
      });
    },
  });

  const createRequirementMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      assignedTo?: string;
      priority: string;
      description: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/requirements`,
        data
      );
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/requirements`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });

      // Check if a phase was unlocked
      if (response?._phaseUnlocked?.unlocked) {
        toast({
          title: "✅ Phase Unlocked!",
          description: `${response._phaseUnlocked.phaseName} — You can now proceed.`,
        });
      }

      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create requirement",
        variant: "destructive",
      });
    },
  });

  const createDocumentMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      content?: string;
      type?: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/documents`,
        data
      );
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/documents`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });

      // Check if a phase was unlocked
      if (response?._phaseUnlocked?.unlocked) {
        toast({
          title: "✅ Phase Unlocked!",
          description: `${response._phaseUnlocked.phaseName} — You can now proceed.`,
        });
      }

      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create document",
        variant: "destructive",
      });
    },
  });

  const createDesignAssetMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      fileType: string;
      fileSize: number;
      fileUrl: string;
      description?: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
        data
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });
      toast({
        title: "Success",
        description: "Design asset uploaded successfully",
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to upload design asset",
        variant: "destructive",
      });
    },
  });

  const createFigmaLinkMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      figmaUrl: string;
      description?: string;
      epicId?: string;
    }) => {
      const result = await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/figma-links`,
        data
      );

      // If epicId is provided, also push to ADO
      if (data.epicId) {
        try {
          const adoResponse = await fetch(
            getApiUrl("/api/ado/push_figma_to_epic"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                epicId: data.epicId,
                figmaLink: data.figmaUrl,
              }),
            }
          );

          if (!adoResponse.ok) {
            console.error("Failed to push to ADO:", await adoResponse.text());
          }
        } catch (error) {
          console.error("Error pushing to ADO:", error);
        }
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/figma-links`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });
      toast({ title: "Success", description: "Figma link added successfully" });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to add Figma link",
        variant: "destructive",
      });
    },
  });

  const createDesignReviewMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      status: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-reviews`,
        data
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-reviews`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/details`],
      });
      toast({
        title: "Success",
        description: "Design review created successfully",
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create design review",
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (featureType === "design-assets" && !fileName) {
      toast({
        title: "Validation Error",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    if (featureType === "figma-link" && !figmaUrl) {
      toast({
        title: "Validation Error",
        description: "Figma URL is required",
        variant: "destructive",
      });
      return;
    }

    if (!title.trim() && featureType !== "design-assets") {
      toast({
        title: "Validation Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    const data = {
      title,
      assignedTo: assignee !== "unassigned" ? assignee : undefined,
      priority,
      description,
    };

    switch (featureType) {
      case "epics":
        createEpicMutation.mutate(data);
        break;
      case "user-stories":
        createBacklogMutation.mutate({ ...data, type: "story" });
        break;
      case "requirements":
        createRequirementMutation.mutate(data);
        break;
      case "documentation":
        createDocumentMutation.mutate({
          title: data.title,
          content: data.description || undefined,
          type: "general",
        });
        break;
      case "design-assets":
        // Convert fileSize from string to integer bytes
        const fileSizeBytes = fileData
          ? Math.round(((fileData.split(",")[1]?.length || 0) * 3) / 4)
          : 0;

        createDesignAssetMutation.mutate({
          name: fileName,
          fileUrl: fileData,
          fileType,
          fileSize: fileSizeBytes,
          description: data.description || undefined,
        });
        break;
      case "figma-link":
        createFigmaLinkMutation.mutate({
          title: data.title,
          figmaUrl,
          description: data.description || undefined,
          epicId: selectedEpicId || undefined,
        });
        break;
      case "review-design":
        createDesignReviewMutation.mutate({
          title: data.title,
          description: data.description || undefined,
          status: "pending",
        });
        break;
      default:
        // For other feature types, just show success (not implemented yet)
        onSuccess();
    }
  };

  const isLoading =
    createEpicMutation.isPending ||
    createBacklogMutation.isPending ||
    createRequirementMutation.isPending ||
    createDocumentMutation.isPending ||
    createDesignAssetMutation.isPending ||
    createFigmaLinkMutation.isPending ||
    createDesignReviewMutation.isPending;
  const renderForm = () => {
    switch (featureType) {
      case "pipelines":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pipeline-name">Pipeline Name</Label>
              <Input
                id="pipeline-name"
                placeholder="main-pipeline"
                data-testid="input-pipeline-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch">Target Branch</Label>
              <Select defaultValue="main">
                <SelectTrigger id="branch" data-testid="select-pipeline-branch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">main</SelectItem>
                  <SelectItem value="develop">develop</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Pipeline description..."
                className="h-24"
                data-testid="textarea-pipeline-description"
              />
            </div>
          </div>
        );

      case "epics":
      case "user-stories":
      case "requirements":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder={`Enter ${featureType} title...`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-item-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignee">Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="assignee" data-testid="select-assignee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  <SelectItem value="alice">Alice Johnson</SelectItem>
                  <SelectItem value="bob">Bob Smith</SelectItem>
                  <SelectItem value="carol">Carol Williams</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority" data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the work item..."
                className="h-32"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="textarea-item-description"
              />
            </div>
          </div>
        );

      case "branches":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">Branch Name</Label>
              <Input
                id="branch-name"
                placeholder="feature/new-feature"
                data-testid="input-branch-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base-branch">Base Branch</Label>
              <Select defaultValue="main">
                <SelectTrigger
                  id="base-branch"
                  data-testid="select-base-branch"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">main</SelectItem>
                  <SelectItem value="develop">develop</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case "releases":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                placeholder="1.0.0"
                data-testid="input-release-version"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-name">Release Name</Label>
              <Input
                id="release-name"
                placeholder="Q4 2024 Release"
                data-testid="input-release-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-notes">Release Notes</Label>
              <Textarea
                id="release-notes"
                placeholder="What's new in this release?"
                className="h-32"
                data-testid="textarea-release-notes"
              />
            </div>
          </div>
        );

      case "design-assets":
        const MAX_FILE_SIZE_MB = 10;
        const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
        const ALLOWED_MIME_TYPES = [
          "image/png",
          "image/jpeg",
          "image/jpg",
          "image/svg+xml",
          "application/pdf",
        ];

        const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (file.size > MAX_FILE_SIZE_BYTES) {
            toast({
              title: "File Too Large",
              description: `File size must not exceed ${MAX_FILE_SIZE_MB}MB. Your file is ${(
                file.size /
                1024 /
                1024
              ).toFixed(2)}MB.`,
              variant: "destructive",
            });
            e.target.value = "";
            return;
          }

          if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            toast({
              title: "Invalid File Type",
              description: `File type must be one of: ${ALLOWED_MIME_TYPES.join(
                ", "
              )}`,
              variant: "destructive",
            });
            e.target.value = "";
            return;
          }

          setFileName(file.name);
          setFileType(file.type);
          setFileSize(`${(file.size / 1024).toFixed(2)} KB`);

          const reader = new FileReader();
          reader.onload = (event) => {
            setFileData(event.target?.result as string);
          };
          reader.readAsDataURL(file);
        };

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Select File</Label>
              <Input
                id="file-upload"
                type="file"
                accept="image/*,.pdf,.sketch,.fig"
                onChange={handleFileChange}
                data-testid="input-file-upload"
              />
              {fileName && (
                <p className="text-sm text-muted-foreground">
                  Selected: {fileName} ({fileSize})
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-description">Description (Optional)</Label>
              <Textarea
                id="asset-description"
                placeholder="Describe the design asset..."
                className="h-24"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="textarea-asset-description"
              />
            </div>
          </div>
        );

      case "figma-link":
        return (
          <div className="space-y-4">
            {/* Step 1: Fetch Epics from ADO */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Step 1: Select Epic from ADO (Optional)</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setIsFetchingEpics(true);
                    try {
                      const response = await fetch("/api/ado/get_epics");
                      if (!response.ok)
                        throw new Error("Failed to fetch epics");
                      const epics = await response.json();
                      setEpicsList(epics);
                      toast({
                        title: "Success",
                        description: `Found ${epics.length} epic(s)`,
                      });
                    } catch (error) {
                      console.error("Error fetching epics:", error);
                      toast({
                        title: "Failed to Fetch Epics",
                        description: "Please check your ADO configuration.",
                        variant: "destructive",
                      });
                    } finally {
                      setIsFetchingEpics(false);
                    }
                  }}
                  disabled={isFetchingEpics}
                >
                  {isFetchingEpics ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <Cloud className="h-3 w-3 mr-2" />
                      Fetch Epics from ADO
                    </>
                  )}
                </Button>
              </div>
              {epicsList.length > 0 && (
                <Select
                  value={selectedEpicId}
                  onValueChange={setSelectedEpicId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an epic (optional)..." />
                  </SelectTrigger>
                  <SelectContent>
                    {epicsList.map((epic: any) => (
                      <SelectItem key={epic.id} value={epic.id}>
                        #{epic.id}: {epic.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Step 2: Title */}
            <div className="space-y-2">
              <Label htmlFor="figma-title">Step 2: Title</Label>
              <Input
                id="figma-title"
                placeholder="Design System v2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-figma-title"
              />
            </div>

            {/* Step 3: Figma URL */}
            <div className="space-y-2">
              <Label htmlFor="figma-url">Step 3: Figma URL</Label>
              <Input
                id="figma-url"
                placeholder="https://www.figma.com/file/..."
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                data-testid="input-figma-url"
              />
              {figmaUrl && figmaUrl.includes("figma.com") && (
                <div className="border rounded-lg overflow-hidden mt-2">
                  <iframe
                    src={`https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(
                      figmaUrl
                    )}`}
                    className="w-full h-[300px]"
                    allowFullScreen
                  />
                </div>
              )}
            </div>

            {/* Step 4: Description */}
            <div className="space-y-2">
              <Label htmlFor="figma-description">
                Step 4: Description (Optional)
              </Label>
              <Textarea
                id="figma-description"
                placeholder="Describe the Figma design..."
                className="h-24"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="textarea-figma-description"
              />
            </div>
          </div>
        );

      case "review-design":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="review-title">Title</Label>
              <Input
                id="review-title"
                placeholder="Dashboard Redesign"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-review-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-description">Description</Label>
              <Textarea
                id="review-description"
                placeholder="Describe what needs to be reviewed..."
                className="h-32"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="textarea-review-description"
              />
            </div>
          </div>
        );

      case "environments":
      case "kubernetes-clusters":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="env-name">Name</Label>
              <Input
                id="env-name"
                placeholder={`${
                  featureType === "environments" ? "Production" : "k8s-cluster"
                }`}
                data-testid="input-env-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="env-type">Type</Label>
              <Select defaultValue="production">
                <SelectTrigger id="env-type" data-testid="select-env-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="env-url">URL</Label>
              <Input
                id="env-url"
                placeholder="https://example.com"
                data-testid="input-env-url"
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Enter name..."
                data-testid="input-generic-name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Enter description..."
                className="h-24"
                data-testid="textarea-generic-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {renderForm()}
      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          data-testid="button-cancel-create"
        >
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          disabled={isLoading}
          data-testid="button-submit-create"
        >
          {isLoading ? (
            <>
              <div className="mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Create
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// BUILD & TESTING COMPONENTS
function PipelinesContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const pipelines = [
    {
      id: 1,
      name: "main-pipeline",
      branch: "main",
      status: "success",
      duration: "5m 23s",
      lastRun: "2 hours ago",
    },
    {
      id: 2,
      name: "develop-pipeline",
      branch: "develop",
      status: "running",
      duration: "3m 45s",
      lastRun: "Just now",
    },
    {
      id: 3,
      name: "feature-auth",
      branch: "feature/auth",
      status: "failed",
      duration: "2m 10s",
      lastRun: "1 day ago",
    },
    {
      id: 4,
      name: "hotfix-login",
      branch: "hotfix/login",
      status: "success",
      duration: "4m 15s",
      lastRun: "3 hours ago",
    },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "running":
        return <Clock className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      success: "default",
      failed: "destructive",
      running: "secondary",
    };
    return <Badge variant={variants[status] || "secondary"}>{status}</Badge>;
  };

  const filtered = pipelines.filter((p) => {
    // Search query filter
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.branch.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="space-y-3">
      {filtered.map((pipeline) => (
        <Card
          key={pipeline.id}
          className="hover-elevate"
          data-testid={`card-pipeline-${pipeline.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {getStatusIcon(pipeline.status)}
                <div>
                  <CardTitle className="text-base">{pipeline.name}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <GitBranch className="h-3 w-3" />
                    {pipeline.branch}
                  </CardDescription>
                </div>
              </div>
              {getStatusBadge(pipeline.status)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Duration: {pipeline.duration}</span>
              <span>{pipeline.lastRun}</span>
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast({
                    title: "Pipeline Running",
                    description: `Started pipeline: ${pipeline.name}`,
                  })
                }
                data-testid={`button-view-pipeline-${pipeline.id}`}
              >
                <Play className="h-3 w-3 mr-1" />
                Run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  toast({
                    title: "Edit Pipeline",
                    description: `Opening editor for: ${pipeline.name}`,
                  })
                }
                data-testid={`button-edit-pipeline-${pipeline.id}`}
              >
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function JobsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const jobs = [
    {
      id: 1,
      name: "build",
      stage: "build",
      status: "success",
      duration: "2m 10s",
    },
    {
      id: 2,
      name: "test-unit",
      stage: "test",
      status: "success",
      duration: "1m 45s",
    },
    {
      id: 3,
      name: "test-integration",
      stage: "test",
      status: "running",
      duration: "3m 20s",
    },
    {
      id: 4,
      name: "deploy-staging",
      stage: "deploy",
      status: "pending",
      duration: "-",
    },
  ];

  const filtered = jobs.filter((j) =>
    j.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((job) => (
        <Card key={job.id} data-testid={`card-job-${job.id}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">{job.name}</h4>
                <p className="text-sm text-muted-foreground">
                  Stage: {job.stage}
                </p>
              </div>
              <div className="text-right">
                <Badge>{job.status}</Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  {job.duration}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PipelineEditorContent({ projectName }: { projectName: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Configuration</CardTitle>
          <CardDescription>
            Edit your CI/CD pipeline YAML configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            className="font-mono text-sm min-h-[400px]"
            defaultValue={`stages:
  - build
  - test
  - deploy

build-job:
  stage: build
  script:
    - npm install
    - npm run build
  artifacts:
    paths:
      - dist/

test-job:
  stage: test
  script:
    - npm run test
  coverage: '/Coverage: \\d+\\.\\d+%/'

deploy-job:
  stage: deploy
  script:
    - npm run deploy
  only:
    - main`}
            data-testid="textarea-pipeline-config"
          />
          <div className="flex gap-2 mt-4">
            <Button
              onClick={() =>
                toast({
                  title: "Pipeline Saved",
                  description: "Pipeline configuration saved successfully!",
                })
              }
              data-testid="button-save-pipeline"
            >
              Save Pipeline
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  title: "Validation Complete",
                  description: "Pipeline configuration is valid!",
                })
              }
              data-testid="button-validate"
            >
              Validate
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArtifactsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const artifacts = [
    {
      id: 1,
      name: "build-artifacts.zip",
      size: "45.2 MB",
      created: "2 hours ago",
      downloads: 12,
    },
    {
      id: 2,
      name: "test-coverage.html",
      size: "2.1 MB",
      created: "2 hours ago",
      downloads: 5,
    },
    {
      id: 3,
      name: "dist.tar.gz",
      size: "38.5 MB",
      created: "1 day ago",
      downloads: 23,
    },
  ];

  const filtered = artifacts.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((artifact) => (
        <Card
          key={artifact.id}
          className="hover-elevate"
          data-testid={`card-artifact-${artifact.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Archive className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium">{artifact.name}</h4>
                  <p className="text-sm text-muted-foreground">
                    {artifact.size} • {artifact.created} • {artifact.downloads}{" "}
                    downloads
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast({
                    title: "Download Started",
                    description: `Downloading ${artifact.name}...`,
                  })
                }
                data-testid={`button-download-artifact-${artifact.id}`}
              >
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SecurityConfigContent({ projectName }: { projectName: string }) {
  return (
    <Tabs defaultValue="scanning" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="scanning" data-testid="tab-scanning">
          Security Scanning
        </TabsTrigger>
        <TabsTrigger value="dependencies" data-testid="tab-dependencies">
          Dependencies
        </TabsTrigger>
        <TabsTrigger value="policies" data-testid="tab-policies">
          Policies
        </TabsTrigger>
      </TabsList>
      <TabsContent value="scanning" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Security Scanners</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <h4 className="font-medium">SAST (Static Analysis)</h4>
                <p className="text-sm text-muted-foreground">
                  Scan source code for vulnerabilities
                </p>
              </div>
              <Badge variant="default">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <h4 className="font-medium">Dependency Scanning</h4>
                <p className="text-sm text-muted-foreground">
                  Check for vulnerable dependencies
                </p>
              </div>
              <Badge variant="default">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <h4 className="font-medium">Container Scanning</h4>
                <p className="text-sm text-muted-foreground">
                  Scan Docker images
                </p>
              </div>
              <Badge variant="secondary">Disabled</Badge>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="dependencies">
        <Card>
          <CardHeader>
            <CardTitle>Vulnerable Dependencies</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No vulnerable dependencies found.
            </p>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="policies">
        <Card>
          <CardHeader>
            <CardTitle>Security Policies</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Configure security policies and compliance rules.
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

// DEPLOYMENT PHASE COMPONENTS
function ReleasesContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const releases = [
    {
      id: 1,
      version: "v2.1.0",
      tag: "v2.1.0",
      date: "2024-10-30",
      status: "published",
      downloads: 1247,
      assets: 5,
    },
    {
      id: 2,
      version: "v2.0.5",
      tag: "v2.0.5",
      date: "2024-10-28",
      status: "published",
      downloads: 3421,
      assets: 5,
    },
    {
      id: 3,
      version: "v2.0.4",
      tag: "v2.0.4",
      date: "2024-10-25",
      status: "draft",
      downloads: 0,
      assets: 3,
    },
  ];

  const filtered = releases.filter((r) =>
    r.version.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((release) => (
        <Card
          key={release.id}
          className="hover-elevate"
          data-testid={`card-release-${release.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  {release.version}
                </CardTitle>
                <CardDescription className="mt-1">
                  {release.date}
                </CardDescription>
              </div>
              <Badge
                variant={
                  release.status === "published" ? "default" : "secondary"
                }
              >
                {release.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
              <span>{release.downloads.toLocaleString()} downloads</span>
              <span>{release.assets} assets</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast({
                    title: "View Release",
                    description: `Opening release ${release.version}`,
                  })
                }
                data-testid={`button-view-release-${release.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast({
                    title: "Download Started",
                    description: `Downloading release ${release.version}...`,
                  })
                }
                data-testid={`button-download-release-${release.id}`}
              >
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FeatureFlagsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const [flags, setFlags] = useState([
    {
      id: "1",
      name: "new-ui-design",
      description: "Enable new dashboard UI",
      enabled: true,
      rollout: 100,
    },
    {
      id: "2",
      name: "ai-suggestions",
      description: "AI-powered code suggestions",
      enabled: true,
      rollout: 50,
    },
    {
      id: "3",
      name: "dark-mode-v2",
      description: "New dark mode theme",
      enabled: false,
      rollout: 0,
    },
    {
      id: "4",
      name: "beta-features",
      description: "Experimental features",
      enabled: false,
      rollout: 10,
    },
  ]);

  const filtered = flags.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((flag) => (
        <Card key={flag.id} data-testid={`card-flag-${flag.id}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1">
                <h4 className="font-medium flex items-center gap-2">
                  <Flag className="h-4 w-4" />
                  {flag.name}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {flag.description}
                </p>
              </div>
              <Switch
                checked={flag.enabled}
                onCheckedChange={(checked) => {
                  setFlags(
                    flags.map((f) =>
                      f.id === flag.id ? { ...f, enabled: checked } : f
                    )
                  );
                }}
                data-testid={`switch-flag-${flag.id}`}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Rollout</span>
                <span className="font-medium">{flag.rollout}%</span>
              </div>
              <Progress value={flag.rollout} className="h-2" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PackageRegistryContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const packages = [
    {
      id: 1,
      name: "@company/ui-components",
      version: "3.2.1",
      downloads: 45231,
      size: "2.3 MB",
      updated: "2 days ago",
    },
    {
      id: 2,
      name: "@company/auth-lib",
      version: "1.8.0",
      downloads: 12443,
      size: "856 KB",
      updated: "1 week ago",
    },
    {
      id: 3,
      name: "@company/api-client",
      version: "2.0.0",
      downloads: 8932,
      size: "1.2 MB",
      updated: "3 days ago",
    },
  ];

  const filtered = packages.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((pkg) => (
        <Card
          key={pkg.id}
          className="hover-elevate"
          data-testid={`card-package-${pkg.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium">{pkg.name}</h4>
                  <p className="text-sm text-muted-foreground">
                    v{pkg.version} • {pkg.size} •{" "}
                    {pkg.downloads.toLocaleString()} downloads
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Updated {pkg.updated}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-install-package-${pkg.id}`}
              >
                <Download className="h-3 w-3 mr-1" />
                Install
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ModelRegistryContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const models = [
    {
      id: 1,
      name: "sentiment-analysis-v2",
      framework: "PyTorch",
      version: "2.1.0",
      accuracy: 94.5,
      size: "145 MB",
      updated: "5 days ago",
    },
    {
      id: 2,
      name: "image-classifier",
      framework: "TensorFlow",
      version: "1.3.2",
      accuracy: 91.2,
      size: "89 MB",
      updated: "1 week ago",
    },
    {
      id: 3,
      name: "recommendation-engine",
      framework: "Scikit-learn",
      version: "3.0.1",
      accuracy: 87.8,
      size: "23 MB",
      updated: "2 days ago",
    },
  ];

  const filtered = models.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((model) => (
        <Card
          key={model.id}
          className="hover-elevate"
          data-testid={`card-model-${model.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  {model.name}
                </CardTitle>
                <CardDescription className="mt-1">
                  {model.framework} • v{model.version}
                </CardDescription>
              </div>
              <Badge>Accuracy: {model.accuracy}%</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
              <span>{model.size}</span>
              <span>Updated {model.updated}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-deploy-model-${model.id}`}
              >
                <Rocket className="h-3 w-3 mr-1" />
                Deploy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`button-download-model-${model.id}`}
              >
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// DEVELOPMENT PHASE COMPONENTS

// Code Generation from User Stories
function DevelopmentOverviewContent({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { toast } = useToast();
  const [selectedStories, setSelectedStories] = useState<Set<number>>(
    new Set()
  );
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<Record<number, string>>(
    {}
  );

  // Fetch repository to get repository ID
  const { data: repositories = [], isLoading: isLoadingRepos } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/repositories`],
    enabled: !!projectId,
  });

  const repository =
    repositories && repositories.length > 0 ? repositories[0] : null;

  // Fetch branches for the repository
  const { data: branches = [], isLoading: isLoadingBranches } = useQuery<any[]>(
    {
      queryKey: [`/api/sdlc/repositories/${repository?.id}/branches`],
      enabled: !!repository?.id,
    }
  );

  // Fetch user stories from local database (workflow artifacts)
  const { data: userStoriesData, isLoading: isLoadingStories } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/phases/1/backlog`],
    enabled: !!projectId,
  });

  const userStories = (userStoriesData || []).map((item: any) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    storyPoints: item.storyPoints,
  }));
  const isLoading = isLoadingRepos || isLoadingBranches || isLoadingStories;

  // Auto-select default branch when branches are loaded
  useEffect(() => {
    if (branches.length > 0 && !selectedBranch) {
      const defaultBranch =
        branches.find((b: any) => b.isDefault) || branches[0];
      setSelectedBranch(defaultBranch.id);
    }
  }, [branches, selectedBranch]);

  const toggleStorySelection = (storyId: number) => {
    const newSelected = new Set(selectedStories);
    if (newSelected.has(storyId)) {
      newSelected.delete(storyId);
    } else {
      newSelected.add(storyId);
    }
    setSelectedStories(newSelected);
  };

  const handleGenerateCode = async () => {
    if (selectedStories.size === 0) {
      toast({
        title: "No Stories Selected",
        description: "Please select at least one user story to generate code",
        variant: "destructive",
      });
      return;
    }

    if (!selectedBranch) {
      toast({
        title: "No Branch Selected",
        description: "Please select a branch to commit the generated code",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const storiesToGenerate = userStories.filter((story: any) =>
        selectedStories.has(story.id)
      );

      const selectedBranchData = branches.find(
        (b: any) => b.id === selectedBranch
      );

      for (const story of storiesToGenerate) {
        // Call code generation API for each selected story
        const response = await apiRequest("POST", `/api/sdlc/generate-code`, {
          projectId,
          repositoryId: repository?.id,
          branchId: selectedBranch,
          branchName: selectedBranchData?.name,
          storyId: story.id,
          title: story.title,
          description: story.description,
        });

        setGeneratedCode((prev) => ({
          ...prev,
          [story.id]: (response as any).code || "Code generation completed",
        }));
      }

      toast({
        title: "Success",
        description: `Code generated and committed to ${
          selectedBranchData?.name || "branch"
        }`,
      });

      // Invalidate commits cache to refresh the commits list
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/repositories/${repository?.id}/commits`],
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate code",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!repository) {
    return (
      <Card data-testid="card-no-repository">
        <CardContent className="p-12 text-center">
          <FileCode className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            No repository found for this project
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Please create a repository in the Repository section first
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Branch Selection and Generate Button */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3
            className="text-lg font-semibold"
            data-testid="text-code-gen-title"
          >
            User Stories from Azure DevOps
          </h3>
          <p className="text-sm text-muted-foreground">
            Select user stories to generate code implementation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-[180px]" data-testid="select-branch">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch: any) => (
                <SelectItem key={branch.id} value={branch.id}>
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3 w-3" />
                    {branch.name}
                    {branch.isDefault && (
                      <Badge variant="outline" className="text-xs ml-1">
                        default
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleGenerateCode}
            disabled={
              isGenerating || selectedStories.size === 0 || !selectedBranch
            }
            data-testid="button-generate-code"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Code className="h-4 w-4 mr-2" />
                Generate Code ({selectedStories.size})
              </>
            )}
          </Button>
        </div>
      </div>

      {/* User Stories List */}
      {userStories.length === 0 ? (
        <Card data-testid="card-no-stories">
          <CardContent className="p-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No user stories found in Azure DevOps
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Create user stories in Phase 1 to generate code
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {userStories.map((story: any) => {
            const storyId = story.id;
            const isSelected = selectedStories.has(storyId);
            const hasGeneratedCode = generatedCode[storyId];

            return (
              <Card
                key={storyId}
                className={`hover-elevate active-elevate-2 cursor-pointer transition-colors ${
                  isSelected ? "border-primary" : ""
                }`}
                onClick={() => toggleStorySelection(storyId)}
                data-testid={`card-story-${storyId}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      className="mt-1"
                      data-testid={`checkbox-story-${storyId}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">
                          #{storyId}
                        </Badge>
                        <h4
                          className="font-medium text-sm line-clamp-1"
                          data-testid={`text-story-title-${storyId}`}
                        >
                          {story.fields?.["System.Title"] || "Untitled Story"}
                        </h4>
                      </div>
                      {story.fields?.["System.Description"] && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                          {story.fields["System.Description"].replace(
                            /<[^>]*>/g,
                            ""
                          )}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {story.fields?.["System.State"] || "New"}
                        </Badge>
                        {story.fields?.[
                          "Microsoft.VSTS.Scheduling.StoryPoints"
                        ] && (
                          <Badge variant="outline" className="text-xs">
                            {
                              story.fields[
                                "Microsoft.VSTS.Scheduling.StoryPoints"
                              ]
                            }{" "}
                            pts
                          </Badge>
                        )}
                        {hasGeneratedCode && (
                          <Badge variant="default" className="text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Code Generated
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Generated Code Preview */}
      {Object.keys(generatedCode).length > 0 && (
        <Card data-testid="card-generated-code">
          <CardHeader>
            <CardTitle className="text-base">Generated Code</CardTitle>
            <CardDescription>
              Code has been generated for the selected user stories
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(generatedCode).map(([storyId, code]) => {
                const story = userStories.find(
                  (s: any) => s.id === parseInt(storyId)
                );
                return (
                  <div key={storyId} className="border rounded-lg p-3">
                    <p className="text-sm font-medium mb-2">
                      #{storyId}: {story ? story.title : "Story"}
                    </p>
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                      {code}
                    </pre>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CodeBrowserContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const files = [
    {
      id: 1,
      name: "index.tsx",
      path: "src/index.tsx",
      type: "file",
      size: "2.3 KB",
      modified: "2 hours ago",
    },
    {
      id: 2,
      name: "App.tsx",
      path: "src/App.tsx",
      type: "file",
      size: "4.1 KB",
      modified: "5 hours ago",
    },
    {
      id: 3,
      name: "utils.ts",
      path: "src/lib/utils.ts",
      type: "file",
      size: "1.8 KB",
      modified: "1 day ago",
    },
    {
      id: 4,
      name: "README.md",
      path: "README.md",
      type: "file",
      size: "3.2 KB",
      modified: "3 days ago",
    },
  ];

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((file) => (
        <Card
          key={file.id}
          className="hover-elevate"
          data-testid={`card-file-${file.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileCode className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium">{file.name}</h4>
                  <p className="text-sm text-muted-foreground">{file.path}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {file.size} • Modified {file.modified}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-file-${file.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RepositoryContent({
  projectName,
  projectId,
  onClose,
}: {
  projectName: string;
  projectId?: string;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const [repoName, setRepoName] = useState(
    `${projectName.replace(/\s+/g, "-")}-Repo`
  );
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreationForm, setShowCreationForm] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Fetch existing repositories
  const { data: repositories = [], isLoading: isLoadingRepos } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/repositories`],
    enabled: !!projectId,
  });

  const isAdoIntegration = integrationType === "ado";

  // Fetch user stories from Azure DevOps (only for ADO projects when showing creation form)
  const { data: userStories = [], isLoading: isLoadingStories } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/user-stories`],
    enabled: !!projectId && showCreationForm && isAdoIntegration,
  });

  const existingRepo =
    repositories && repositories.length > 0 ? repositories[0] : null;
  const isLoading = isLoadingRepos || (showCreationForm && isLoadingStories);

  // Automatically show creation form when no repository exists (only once on initial load)
  useEffect(() => {
    if (
      !isLoadingRepos &&
      !existingRepo &&
      !showCreationForm &&
      !hasAutoOpened
    ) {
      setShowCreationForm(true);
      setHasAutoOpened(true);
    }
  }, [isLoadingRepos, existingRepo, showCreationForm, hasAutoOpened]);

  const handleStoryToggle = (storyId: string) => {
    setSelectedStoryIds((prev) =>
      prev.includes(storyId)
        ? prev.filter((id) => id !== storyId)
        : [...prev, storyId]
    );
  };

  const handleSelectAll = () => {
    if (selectedStoryIds.length === userStories.length) {
      setSelectedStoryIds([]);
    } else {
      setSelectedStoryIds(userStories.map((story: any) => story.id));
    }
  };

  const handleCreateRepository = async () => {
    if (!repoName.trim()) {
      toast({
        title: "Validation Error",
        description: "Repository name is required",
        variant: "destructive",
      });
      return;
    }

    // Only require story selection if stories are available
    if (userStories.length > 0 && selectedStoryIds.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one user story",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/create-repo-with-code`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            repoName: repoName.trim(),
            selectedUserStoryIds: selectedStoryIds,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create repository");
      }

      const result = await response.json();

      toast({
        title: "Repository Created",
        description: `Successfully created repository "${repoName}" with generated code!`,
      });

      // Refresh repository list and hide creation form
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/repositories`],
      });
      setShowCreationForm(false);

      // Close dialog after brief delay to show success
      setTimeout(() => {
        if (onClose) onClose();
      }, 1000);
    } catch (error) {
      console.error("Error creating repository:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create repository",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">
            {showCreationForm
              ? "Loading user stories..."
              : "Loading repository..."}
          </p>
        </div>
      </div>
    );
  }

  // Show repository info if it exists and we're not in creation mode
  if (existingRepo && !showCreationForm) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderGit2 className="h-5 w-5" />
              {existingRepo.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p
                  className={`font-medium capitalize ${
                    existingRepo.status === "active"
                      ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {existingRepo.status || "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="font-medium">
                  {existingRepo.createdAt
                    ? new Date(existingRepo.createdAt).toLocaleDateString()
                    : "N/A"}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-2">
                Repository ID
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {existingRepo.id}
              </code>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-close"
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  // Show creation form if no repository exists or user clicked "create new"
  if (!existingRepo || showCreationForm) {
    return (
      <div className="space-y-4">
        <div>
          <label
            htmlFor="repo-name"
            className="text-sm font-medium mb-1.5 block"
          >
            Repository Name
          </label>
          <Input
            id="repo-name"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="Enter repository name"
            data-testid="input-repo-name"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">
              Select User Stories ({selectedStoryIds.length} of{" "}
              {userStories.length})
            </label>
            {userStories.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSelectAll}
                data-testid="button-select-all-stories"
              >
                {selectedStoryIds.length === userStories.length
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            )}
          </div>

          {userStories.length === 0 ? (
            <div className="border rounded-md p-6 text-center">
              <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No user stories found in Azure DevOps.
                <br />
                You can still create the repository, but no code will be
                generated.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[300px] border rounded-md p-3">
              <div className="space-y-2">
                {userStories.map((story: any) => (
                  <div
                    key={story.id}
                    className="flex items-start gap-2 p-2 rounded-md hover-elevate cursor-pointer"
                    onClick={() => handleStoryToggle(story.id)}
                    data-testid={`story-item-${story.id}`}
                  >
                    <Checkbox
                      checked={selectedStoryIds.includes(story.id)}
                      className="mt-0.5"
                      data-testid={`checkbox-story-${story.id}`}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-tight">
                        {story.title}
                      </p>
                      {story.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {story.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateRepository}
            disabled={
              isCreating ||
              (userStories.length > 0 && selectedStoryIds.length === 0)
            }
            data-testid="button-submit-repo"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <GitBranch className="h-4 w-4 mr-2" />
                Create Repository
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }
}

function BranchesContent({
  projectName,
  projectId,
  searchQuery,
}: {
  projectName: string;
  projectId?: string;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const [createSubBranchDialogOpen, setCreateSubBranchDialogOpen] =
    useState(false);
  const [selectedParentBranch, setSelectedParentBranch] = useState<string>("");
  const [subBranchName, setSubBranchName] = useState("");
  const [codebaseUrl, setCodebaseUrl] = useState("");
  const [, setLocation] = useLocation();

  // Fetch repository to get repository ID
  const { data: repositories = [], isLoading: isLoadingRepos } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/repositories`],
    enabled: !!projectId,
  });

  const repository =
    repositories && repositories.length > 0 ? repositories[0] : null;

  // Fetch branches for the repository
  const { data: branches = [], isLoading: isLoadingBranches } = useQuery<any[]>(
    {
      queryKey: [`/api/sdlc/repositories/${repository?.id}/branches`],
      enabled: !!repository?.id,
    }
  );

  // Sub-branches (stored in state - in a real app, this would be fetched from a database)
  const [subBranches, setSubBranches] = useState<
    Array<{
      name: string;
      parent: string;
      codebaseUrl: string;
      commits: string;
      lastUpdate: string;
    }>
  >([]);

  const handleCreateSubBranch = (parentBranch: string) => {
    setSelectedParentBranch(parentBranch);
    setSubBranchName("");
    setCodebaseUrl("");
    setCreateSubBranchDialogOpen(true);
  };

  const handleSaveSubBranch = () => {
    if (!subBranchName.trim()) {
      toast({
        title: "Validation Error",
        description: "Branch name is required",
        variant: "destructive",
      });
      return;
    }

    if (!codebaseUrl.trim()) {
      toast({
        title: "Validation Error",
        description: "Codebase URL is required",
        variant: "destructive",
      });
      return;
    }

    // Add the new sub-branch
    setSubBranches((prev) => [
      ...prev,
      {
        name: subBranchName,
        parent: selectedParentBranch,
        codebaseUrl: codebaseUrl,
        commits: "0 commits",
        lastUpdate: "Just now",
      },
    ]);

    toast({
      title: "Sub-branch Created",
      description: `Sub-branch '${subBranchName}' created from '${selectedParentBranch}'`,
    });

    setCreateSubBranchDialogOpen(false);
  };

  const handleSubBranchClick = (url: string) => {
    if (url) {
      window.open(url, "_blank");
    }
  };

  const isLoading = isLoadingRepos || isLoadingBranches;
  const filtered = branches.filter((b: any) =>
    b.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading branches...</p>
        </div>
      </div>
    );
  }

  if (!repository) {
    return (
      <div className="border rounded-md p-8 text-center">
        <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          No repository found for this project.
          <br />
          Please create a repository first.
        </p>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="border rounded-md p-8 text-center">
        <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          No branches found in this repository.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filtered.map((branch: any) => (
        <div key={branch.id} className="space-y-2">
          {/* Parent Branch Card */}
          <Card
            className="hover-elevate"
            data-testid={`card-branch-${branch.name}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitBranch className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <h4 className="font-medium flex items-center gap-2">
                      {branch.name}
                      {branch.isDefault && (
                        <Badge variant="default">Default</Badge>
                      )}
                      {branch.isProtected && (
                        <Badge variant="outline">Protected</Badge>
                      )}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Created{" "}
                      {branch.createdAt
                        ? new Date(branch.createdAt).toLocaleDateString()
                        : "N/A"}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCreateSubBranch(branch.name)}
                  data-testid={`button-create-subbranch-${branch.name}`}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create Sub-branch
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Sub-branches */}
          {subBranches
            .filter((sb) => sb.parent === branch.name)
            .map((subBranch) => (
              <Card
                key={subBranch.name}
                className="ml-8 hover-elevate cursor-pointer active-elevate-2"
                onClick={() => handleSubBranchClick(subBranch.codebaseUrl)}
                data-testid={`card-subbranch-${subBranch.name}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <h5 className="text-sm font-medium">
                          {subBranch.name}
                        </h5>
                        <p className="text-xs text-muted-foreground">
                          {subBranch.commits} • Updated {subBranch.lastUpdate}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <span>View Codebase</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      ))}

      {/* Create Sub-branch Dialog */}
      <Dialog
        open={createSubBranchDialogOpen}
        onOpenChange={setCreateSubBranchDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Create Sub-branch from {selectedParentBranch}
            </DialogTitle>
            <DialogDescription>
              Create a new sub-branch and provide the codebase URL for this
              branch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subbranch-name">Sub-branch Name *</Label>
              <Input
                id="subbranch-name"
                placeholder="e.g., feature/user-auth"
                value={subBranchName}
                onChange={(e) => setSubBranchName(e.target.value)}
                data-testid="input-subbranch-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="codebase-url">Codebase URL *</Label>
              <Input
                id="codebase-url"
                placeholder="https://github.com/user/repo/tree/branch-name"
                value={codebaseUrl}
                onChange={(e) => setCodebaseUrl(e.target.value)}
                data-testid="input-codebase-url"
              />
              <p className="text-xs text-muted-foreground">
                Provide the full URL to the codebase for this branch (e.g.,
                GitHub, GitLab, etc.)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateSubBranchDialogOpen(false)}
              data-testid="button-cancel-subbranch"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSubBranch}
              data-testid="button-save-subbranch"
            >
              <Save className="h-4 w-4 mr-2" />
              Create Sub-branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommitsContent({
  projectName,
  projectId,
  searchQuery,
}: {
  projectName: string;
  projectId?: string;
  searchQuery: string;
}) {
  // Fetch repository to get repository ID
  const { data: repositories = [], isLoading: isLoadingRepos } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/repositories`],
    enabled: !!projectId,
  });

  const repository =
    repositories && repositories.length > 0 ? repositories[0] : null;

  // Fetch commits for the repository
  const { data: commits = [], isLoading: isLoadingCommits } = useQuery<any[]>({
    queryKey: [`/api/sdlc/repositories/${repository?.id}/commits`],
    enabled: !!repository?.id,
  });

  // Fetch branches for the repository to map branchId to branch name
  const { data: branches = [], isLoading: isLoadingBranches } = useQuery<any[]>(
    {
      queryKey: [`/api/sdlc/repositories/${repository?.id}/branches`],
      enabled: !!repository?.id,
    }
  );

  // Create a map of branchId to branch name
  const branchMap = branches.reduce(
    (map: Record<string, string>, branch: any) => {
      map[branch.id] = branch.name;
      return map;
    },
    {}
  );

  const isLoading = isLoadingRepos || isLoadingCommits || isLoadingBranches;

  const filtered = commits.filter(
    (c: any) =>
      c.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.author?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading commits...</p>
        </div>
      </div>
    );
  }

  if (!repository) {
    return (
      <div className="border rounded-md p-8 text-center">
        <GitCommit className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          No repository found for this project.
          <br />
          Please create a repository first.
        </p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="border rounded-md p-8 text-center">
        <GitCommit className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          No commits found in this repository.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((commit: any, index: number) => (
        <Card
          key={commit.id}
          className="hover-elevate"
          data-testid={`card-commit-${commit.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <GitCommit className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium flex items-center gap-2 flex-wrap">
                    {commit.commitNumber
                      ? `${commit.commitNumber}${
                          commit.commitNumber === 1
                            ? "st"
                            : commit.commitNumber === 2
                            ? "nd"
                            : commit.commitNumber === 3
                            ? "rd"
                            : "th"
                        } commit - `
                      : ""}
                    {commit.message}
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    {commit.branchId && branchMap[commit.branchId] && (
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        data-testid={`badge-branch-${commit.id}`}
                      >
                        <GitBranch className="h-3 w-3 mr-1" />
                        {branchMap[commit.branchId]}
                      </Badge>
                    )}
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    {commit.author} •{" "}
                    {commit.createdAt
                      ? new Date(commit.createdAt).toLocaleDateString()
                      : "N/A"}
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded mt-2 inline-block">
                    {commit.id.substring(0, 7)}
                  </code>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-commit-${commit.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MergeRequestsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const mergeRequests = [
    {
      id: 1,
      title: "Feature: Add dark mode support",
      source: "feature/dark-mode",
      target: "develop",
      author: "John Doe",
      status: "open",
      comments: 5,
      approvals: 2,
    },
    {
      id: 2,
      title: "Fix: Resolve API timeout issues",
      source: "hotfix/api-timeout",
      target: "main",
      author: "Jane Smith",
      status: "approved",
      comments: 3,
      approvals: 3,
    },
    {
      id: 3,
      title: "Docs: Update contribution guidelines",
      source: "docs/contribution",
      target: "develop",
      author: "Bob Wilson",
      status: "merged",
      comments: 1,
      approvals: 2,
    },
  ];

  const filtered = mergeRequests.filter((mr) =>
    mr.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((mr) => (
        <Card
          key={mr.id}
          className="hover-elevate"
          data-testid={`card-mr-${mr.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{mr.title}</CardTitle>
                <CardDescription className="mt-1 flex items-center gap-2">
                  <GitMerge className="h-3 w-3" />
                  {mr.source} → {mr.target}
                </CardDescription>
              </div>
              <Badge
                variant={
                  mr.status === "merged"
                    ? "default"
                    : mr.status === "approved"
                    ? "secondary"
                    : "outline"
                }
              >
                {mr.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
              <span>{mr.author}</span>
              <div className="flex items-center gap-3">
                <span>{mr.comments} comments</span>
                <span>{mr.approvals} approvals</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-review-mr-${mr.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                Review
              </Button>
              {mr.status === "open" && (
                <Button size="sm" data-testid={`button-approve-mr-${mr.id}`}>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Approve
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TagsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const tags = [
    {
      id: 1,
      name: "v2.1.0",
      commit: "a3b2c1d",
      message: "Release version 2.1.0",
      date: "2024-10-30",
      author: "John Doe",
    },
    {
      id: 2,
      name: "v2.0.5",
      commit: "b4c3d2e",
      message: "Patch release 2.0.5",
      date: "2024-10-28",
      author: "Jane Smith",
    },
    {
      id: 3,
      name: "v2.0.0",
      commit: "c5d4e3f",
      message: "Major release 2.0.0",
      date: "2024-10-15",
      author: "Bob Wilson",
    },
  ];

  const filtered = tags.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((tag) => (
        <Card
          key={tag.id}
          className="hover-elevate"
          data-testid={`card-tag-item-${tag.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Tag className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium">{tag.name}</h4>
                  <p className="text-sm text-muted-foreground">{tag.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tag.author} • {tag.date}
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded mt-2 inline-block">
                    {tag.commit}
                  </code>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-download-tag-item-${tag.id}`}
              >
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// DESIGN PHASE COMPONENTS
function SnippetsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const snippets = [
    {
      id: 1,
      title: "Auth Helper Function",
      language: "TypeScript",
      lines: 25,
      created: "2 days ago",
      visibility: "Private",
    },
    {
      id: 2,
      title: "Custom React Hook",
      language: "JavaScript",
      lines: 45,
      created: "1 week ago",
      visibility: "Public",
    },
    {
      id: 3,
      title: "SQL Query Template",
      language: "SQL",
      lines: 12,
      created: "3 days ago",
      visibility: "Private",
    },
  ];

  const filtered = snippets.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((snippet) => (
        <Card
          key={snippet.id}
          className="hover-elevate"
          data-testid={`card-snippet-${snippet.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Code className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium">{snippet.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    {snippet.language} • {snippet.lines} lines • Created{" "}
                    {snippet.created}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Badge
                  variant={
                    snippet.visibility === "Public" ? "default" : "secondary"
                  }
                >
                  {snippet.visibility}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`button-view-snippet-${snippet.id}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RepositoryGraphContent({ projectName }: { projectName: string }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Commit Graph</CardTitle>
          <CardDescription>
            Visual representation of repository activity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center border rounded-lg bg-muted/20">
            <div className="text-center space-y-2">
              <Network className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Interactive commit graph visualization
              </p>
              <p className="text-xs text-muted-foreground">
                Shows branch history and merge patterns
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">247</div>
            <div className="text-sm text-muted-foreground">Total Commits</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">12</div>
            <div className="text-sm text-muted-foreground">Active Branches</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">8</div>
            <div className="text-sm text-muted-foreground">Contributors</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Initial UI Components Data
const initialUiComponents = [
  {
    id: "1",
    name: "Primary Button",
    type: "Interactive Element",
    description:
      "Main call-to-action button for form submissions and primary user actions.",
    usage:
      "Use for the most important action on a page. Limit to one per screen for clear visual hierarchy.",
    codeSnippet: '<Button variant="default">Submit</Button>',
    notes: "",
  },
  {
    id: "2",
    name: "Input Field",
    type: "Form Element",
    description:
      "Standard text input for user data entry with validation support.",
    usage:
      "Use for single-line text inputs like names, emails, and search queries. Always include proper labels.",
    codeSnippet: '<Input placeholder="Enter text..." />',
    notes: "",
  },
  {
    id: "3",
    name: "Navigation Menu",
    type: "UI Component",
    description:
      "Top-level navigation with dropdown support for organizing site sections.",
    usage:
      "Place at the top of the application. Keep menu items between 4-7 for optimal usability.",
    codeSnippet:
      "<NavigationMenu><NavigationMenuList>...</NavigationMenuList></NavigationMenu>",
    notes: "",
  },
  {
    id: "4",
    name: "Data Table",
    type: "UI Component",
    description:
      "Sortable and filterable table for displaying structured data sets.",
    usage:
      "Use for displaying collections of items with multiple attributes. Include pagination for large datasets.",
    codeSnippet:
      "<Table><TableHeader>...</TableHeader><TableBody>...</TableBody></Table>",
    notes: "",
  },
  {
    id: "5",
    name: "Modal Dialog",
    type: "Interactive Element",
    description:
      "Overlay component for focused user interactions and confirmations.",
    usage:
      "Use sparingly for critical actions that require user attention. Always provide a clear close mechanism.",
    codeSnippet: "<Dialog><DialogContent>...</DialogContent></Dialog>",
    notes: "",
  },
];

function DesignAssetsContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const [components, setComponents] = useState(initialUiComponents);
  const [viewComponent, setViewComponent] = useState<
    (typeof initialUiComponents)[0] | null
  >(null);
  const [editComponent, setEditComponent] = useState<
    (typeof initialUiComponents)[0] | null
  >(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const filtered = components.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleView = (component: (typeof initialUiComponents)[0]) => {
    setViewComponent(component);
    setViewDialogOpen(true);
  };

  const handleEdit = (component: (typeof initialUiComponents)[0]) => {
    setEditComponent(component);
    setEditDescription(component.description);
    setEditNotes(component.notes || "");
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (editComponent) {
      // Update the component in state
      setComponents((prev) =>
        prev.map((c) =>
          c.id === editComponent.id
            ? { ...c, description: editDescription, notes: editNotes }
            : c
        )
      );

      toast({
        title: "Success",
        description: "Component details updated successfully",
      });
    }
    setEditDialogOpen(false);
  };

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <div className="text-center space-y-2">
          <Palette className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No UI components found matching your search.
          </p>
          <p className="text-xs text-muted-foreground">
            Try adjusting your search terms.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4">
        <p
          className="text-sm text-muted-foreground"
          data-testid="text-components-count"
        >
          {components.length} UI component{components.length !== 1 ? "s" : ""}{" "}
          available
        </p>
      </div>

      <div className="space-y-3">
        {filtered.map((component) => (
          <Card
            key={component.id}
            className="hover-elevate"
            data-testid={`card-component-${component.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Palette className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium">{component.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {component.type}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {component.description}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleView(component)}
                    data-testid={`button-view-component-${component.id}`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(component)}
                    data-testid={`button-edit-component-${component.id}`}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent
          className="max-w-3xl"
          data-testid="dialog-view-component"
        >
          <DialogHeader>
            <DialogTitle data-testid="text-component-name">
              {viewComponent?.name}
            </DialogTitle>
            <DialogDescription data-testid="text-component-type">
              {viewComponent?.type}
            </DialogDescription>
          </DialogHeader>
          {viewComponent && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Description</h4>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-component-description"
                >
                  {viewComponent.description}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Usage Guidelines</h4>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-component-usage"
                >
                  {viewComponent.usage}
                </p>
              </div>
              {viewComponent.notes && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Additional Notes</h4>
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="text-component-notes"
                  >
                    {viewComponent.notes}
                  </p>
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium mb-2">Code Example</h4>
                <div
                  className="border rounded-lg p-4 bg-muted/20 font-mono text-sm"
                  data-testid="text-component-code"
                >
                  {viewComponent.codeSnippet}
                </div>
              </div>
              <div
                className="border rounded-lg p-8 bg-muted/10 flex items-center justify-center"
                data-testid="preview-component-area"
              >
                <div className="text-center space-y-2">
                  <Palette className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Component Preview
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {viewComponent.name}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent
          className="max-w-2xl"
          data-testid="dialog-edit-component"
        >
          <DialogHeader>
            <DialogTitle>Edit {editComponent?.name}</DialogTitle>
            <DialogDescription>
              Update component description and notes
            </DialogDescription>
          </DialogHeader>
          {editComponent && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="h-24"
                  data-testid="textarea-edit-description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-notes">Additional Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add any additional notes or customizations..."
                  className="h-32"
                  data-testid="textarea-edit-notes"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditDialogOpen(false)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} data-testid="button-save-edit">
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OldDesignAssetsContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const [previewAsset, setPreviewAsset] = useState<any>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

  const {
    data: assets = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
    ],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/sync-documents-to-design`
      );
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${projectId}/phases`],
      });
      toast({
        title: "Success",
        description: `Documentation synced successfully. ${data.syncedCount} new asset(s) imported.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to sync documents",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/sdlc/design-assets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
        ],
      });
      toast({
        title: "Success",
        description: "Design asset deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete design asset",
        variant: "destructive",
      });
    },
  });

  const filtered = assets.filter((a) =>
    a.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePreview = (asset: any) => {
    setPreviewAsset(asset);
    setPreviewDialogOpen(true);
  };

  const handleDownload = (asset: any) => {
    const link = document.createElement("a");
    link.href = asset.fileUrl;
    link.download = asset.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({
      title: "Success",
      description: "Design asset downloaded successfully",
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this design asset?")) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading design assets...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load design assets
            </p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-retry-assets"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <div className="text-center space-y-2">
          <Palette className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? "No design assets found matching your search"
              : "No design assets yet."}
          </p>
          <p className="text-xs text-muted-foreground">
            Sync documents from Requirements or upload manually to get started.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          data-testid="button-sync-documents-empty"
        >
          <RefreshCw
            className={`h-3 w-3 mr-2 ${
              syncMutation.isPending ? "animate-spin" : ""
            }`}
          />
          Sync Documents
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {assets.length} asset{assets.length !== 1 ? "s" : ""} •{" "}
          {assets.filter((a) => a.source === "synced_from_requirement").length}{" "}
          synced from Requirements
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          data-testid="button-sync-documents"
        >
          <RefreshCw
            className={`h-3 w-3 mr-2 ${
              syncMutation.isPending ? "animate-spin" : ""
            }`}
          />
          Sync Documents
        </Button>
      </div>

      <div className="space-y-3">
        {filtered.map((asset) => (
          <Card
            key={asset.id}
            className="hover-elevate"
            data-testid={`card-asset-${asset.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Palette className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium truncate">{asset.name}</h4>
                      {asset.source === "synced_from_requirement" && (
                        <Badge
                          variant="secondary"
                          className="text-xs shrink-0"
                          data-testid={`badge-synced-${asset.id}`}
                        >
                          Synced from Requirement
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {asset.fileType} •{" "}
                      {asset.fileSize
                        ? `${(asset.fileSize / 1024).toFixed(2)} KB`
                        : "Unknown size"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Updated: {new Date(asset.updatedAt).toLocaleDateString()}{" "}
                      at{" "}
                      {new Date(asset.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {asset.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {asset.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePreview(asset)}
                    data-testid={`button-preview-asset-${asset.id}`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDownload(asset)}
                    data-testid={`button-download-asset-${asset.id}`}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(asset.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-asset-${asset.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl" data-testid="dialog-preview-asset">
          <DialogHeader>
            <DialogTitle>{previewAsset?.name}</DialogTitle>
          </DialogHeader>
          {previewAsset && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4 bg-muted/20 max-h-[60vh] overflow-auto">
                <img
                  src={previewAsset.fileUrl}
                  alt={previewAsset.name}
                  className="max-w-full h-auto mx-auto"
                  data-testid="img-preview-asset"
                />
              </div>
              {previewAsset.description && (
                <div>
                  <h4 className="font-medium mb-1">Description</h4>
                  <p className="text-sm text-muted-foreground">
                    {previewAsset.description}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => handleDownload(previewAsset)}
                  data-testid="button-download-preview"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPreviewDialogOpen(false)}
                  data-testid="button-close-preview"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FigmaLinkContent({
  projectId,
  projectName,
  phaseNumber,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
}) {
  const { toast } = useToast();
  const [selectedEpicId, setSelectedEpicId] = useState<string>("");
  const [epicsList, setEpicsList] = useState<any[]>([]);
  const [isFetchingEpics, setIsFetchingEpics] = useState(false);
  const [figmaUrl, setFigmaUrl] = useState("");

  const {
    data: figmaLinks = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/figma-links`,
    ],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/sdlc/figma-links/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/figma-links`,
        ],
      });
      toast({
        title: "Success",
        description: "Figma link deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete Figma link",
        variant: "destructive",
      });
    },
  });

  const handleFetchEpics = async () => {
    setIsFetchingEpics(true);
    try {
      const response = await fetch("/api/ado/get_epics");
      if (!response.ok) throw new Error("Failed to fetch epics");
      const epics = await response.json();
      setEpicsList(epics);
      if (epics.length === 0) {
        toast({
          title: "No Epics Found",
          description: "No Epics found in Azure DevOps",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Epics Loaded",
          description: `Found ${epics.length} epic(s)`,
        });
      }
    } catch (error) {
      console.error("Error fetching epics:", error);
      toast({
        title: "Failed to Fetch Epics",
        description: "Please check your ADO configuration.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingEpics(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: { figmaUrl: string; epicId: string }) => {
      // First create the Figma link
      const result = await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/figma-links`,
        {
          title: "Figma Design",
          figmaUrl: data.figmaUrl,
        }
      );

      // Then push to ADO
      const adoResponse = await fetch("/api/ado/push_figma_to_epic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epicId: data.epicId,
          figmaLink: data.figmaUrl,
        }),
      });

      if (!adoResponse.ok) {
        throw new Error("Failed to push to ADO");
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/figma-links`,
        ],
      });
      toast({
        title: "Success",
        description: "Figma link added and pushed to ADO Epic",
      });
      setFigmaUrl("");
      setSelectedEpicId("");
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to add Figma link",
        variant: "destructive",
      });
    },
  });

  const handlePushToAdo = () => {
    if (!selectedEpicId) {
      toast({
        title: "No Epic Selected",
        description: "Please select an Epic first",
        variant: "destructive",
      });
      return;
    }

    if (!figmaUrl.trim()) {
      toast({
        title: "Validation Error",
        description: "Figma URL is required",
        variant: "destructive",
      });
      return;
    }

    if (!figmaUrl.includes("figma.com")) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid Figma URL",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({ figmaUrl, epicId: selectedEpicId });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this Figma link?")) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading Figma links...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load Figma links
            </p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-retry-figma"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Fetch Epics Section */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Step 1: Fetch Epics from ADO
              </Label>
              <Button
                size="sm"
                variant="outline"
                onClick={handleFetchEpics}
                disabled={isFetchingEpics}
              >
                {isFetchingEpics ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <Cloud className="h-3 w-3 mr-2" />
                    Fetch Epics
                  </>
                )}
              </Button>
            </div>

            {epicsList.length > 0 && (
              <>
                <div className="space-y-2">
                  <Label>Step 2: Select Epic</Label>
                  <Select
                    value={selectedEpicId}
                    onValueChange={setSelectedEpicId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an Epic..." />
                    </SelectTrigger>
                    <SelectContent>
                      {epicsList.map((epic) => (
                        <SelectItem key={epic.id} value={epic.id}>
                          #{epic.id}: {epic.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Step 3: Enter Figma URL</Label>
                  <Input
                    placeholder="https://www.figma.com/file/..."
                    value={figmaUrl}
                    onChange={(e) => setFigmaUrl(e.target.value)}
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handlePushToAdo}
                    disabled={
                      createMutation.isPending || !selectedEpicId || !figmaUrl
                    }
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Pushing to ADO...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Push to ADO
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// MAINTENANCE PHASE COMPONENTS
function EnvironmentsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const environments = [
    {
      id: 1,
      name: "Production",
      status: "healthy",
      uptime: "99.98%",
      deployments: 45,
      lastDeploy: "2 hours ago",
    },
    {
      id: 2,
      name: "Staging",
      status: "healthy",
      uptime: "99.85%",
      deployments: 123,
      lastDeploy: "30 min ago",
    },
    {
      id: 3,
      name: "Development",
      status: "warning",
      uptime: "98.5%",
      deployments: 456,
      lastDeploy: "5 min ago",
    },
  ];

  const filtered = environments.filter((e) =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((env) => (
        <Card
          key={env.id}
          className="hover-elevate"
          data-testid={`card-env-${env.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium flex items-center gap-2">
                    {env.name}
                    <Badge
                      variant={
                        env.status === "healthy" ? "default" : "secondary"
                      }
                    >
                      {env.status}
                    </Badge>
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Uptime: {env.uptime} • Last deploy: {env.lastDeploy}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-manage-env-${env.id}`}
              >
                <Settings className="h-3 w-3 mr-1" />
                Manage
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {env.deployments} deployments
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function KubernetesClustersContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const clusters = [
    {
      id: 1,
      name: "production-cluster",
      region: "us-east-1",
      nodes: 5,
      status: "running",
      version: "1.28.3",
    },
    {
      id: 2,
      name: "staging-cluster",
      region: "us-west-2",
      nodes: 3,
      status: "running",
      version: "1.28.3",
    },
    {
      id: 3,
      name: "dev-cluster",
      region: "eu-central-1",
      nodes: 2,
      status: "stopped",
      version: "1.27.8",
    },
  ];

  const filtered = clusters.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((cluster) => (
        <Card
          key={cluster.id}
          className="hover-elevate"
          data-testid={`card-cluster-${cluster.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Container className="h-4 w-4" />
                  {cluster.name}
                </CardTitle>
                <CardDescription className="mt-1">
                  {cluster.region} • Kubernetes {cluster.version}
                </CardDescription>
              </div>
              <Badge
                variant={cluster.status === "running" ? "default" : "secondary"}
              >
                {cluster.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
              <span>{cluster.nodes} nodes</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-cluster-${cluster.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`button-configure-cluster-${cluster.id}`}
              >
                <Settings className="h-3 w-3 mr-1" />
                Configure
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TerraformStatesContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const states = [
    {
      id: 1,
      name: "production-infra",
      workspace: "default",
      resources: 45,
      lastModified: "2 days ago",
      status: "synced",
    },
    {
      id: 2,
      name: "staging-infra",
      workspace: "staging",
      resources: 32,
      lastModified: "1 week ago",
      status: "synced",
    },
    {
      id: 3,
      name: "dev-infra",
      workspace: "dev",
      resources: 18,
      lastModified: "3 hours ago",
      status: "drift",
    },
  ];

  const filtered = states.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((state) => (
        <Card
          key={state.id}
          className="hover-elevate"
          data-testid={`card-state-${state.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium flex items-center gap-2">
                    {state.name}
                    <Badge
                      variant={
                        state.status === "synced" ? "default" : "secondary"
                      }
                    >
                      {state.status}
                    </Badge>
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Workspace: {state.workspace} • {state.resources} resources
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last modified {state.lastModified}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-state-${state.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MonitorContent({ projectName }: { projectName: string }) {
  return (
    <Tabs defaultValue="metrics" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="metrics" data-testid="tab-metrics">
          Metrics
        </TabsTrigger>
        <TabsTrigger value="logs" data-testid="tab-logs">
          Logs
        </TabsTrigger>
        <TabsTrigger value="alerts" data-testid="tab-alerts">
          Alerts
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
            <Card key={idx} data-testid={`card-monitor-metric-${idx}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <metric.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {metric.label}
                  </span>
                </div>
                <div className="text-2xl font-bold">{metric.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="logs">
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2 font-mono text-xs">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="p-2 border rounded bg-muted/20"
                  data-testid={`log-monitor-${i}`}
                >
                  <span className="text-muted-foreground">
                    [{new Date().toLocaleTimeString()}]
                  </span>{" "}
                  Request processed - 200 OK
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="alerts">
        <Card>
          <CardContent className="p-4">
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">No active alerts</p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function ErrorTrackingContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const errors = [
    {
      id: 1,
      title: "TypeError: Cannot read property 'id'",
      count: 45,
      lastSeen: "5 min ago",
      status: "unresolved",
      severity: "high",
    },
    {
      id: 2,
      title: "API timeout in /users endpoint",
      count: 12,
      lastSeen: "2 hours ago",
      status: "resolved",
      severity: "medium",
    },
    {
      id: 3,
      title: "Database connection failed",
      count: 3,
      lastSeen: "1 day ago",
      status: "unresolved",
      severity: "critical",
    },
  ];

  const filtered = errors.filter((e) =>
    e.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((error) => (
        <Card
          key={error.id}
          className="hover-elevate"
          data-testid={`card-error-${error.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <AlertCircle
                  className={`h-5 w-5 mt-0.5 ${
                    error.severity === "critical"
                      ? "text-red-500"
                      : error.severity === "high"
                      ? "text-orange-500"
                      : "text-yellow-500"
                  }`}
                />
                <div className="flex-1">
                  <h4 className="font-medium">{error.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    {error.count} occurrences • Last seen {error.lastSeen}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Badge
                      variant={
                        error.status === "resolved" ? "default" : "destructive"
                      }
                    >
                      {error.status}
                    </Badge>
                    <Badge variant="outline">{error.severity}</Badge>
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-error-${error.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AlertsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const alerts = [
    {
      id: 1,
      title: "High Memory Usage",
      condition: "Memory > 80%",
      status: "firing",
      severity: "warning",
      triggered: "10 min ago",
    },
    {
      id: 2,
      title: "API Response Time",
      condition: "Response time > 2s",
      status: "resolved",
      severity: "info",
      triggered: "2 hours ago",
    },
    {
      id: 3,
      title: "Error Rate Spike",
      condition: "Errors > 5%",
      status: "firing",
      severity: "critical",
      triggered: "30 min ago",
    },
  ];

  const filtered = alerts.filter((a) =>
    a.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((alert) => (
        <Card
          key={alert.id}
          className="hover-elevate"
          data-testid={`card-alert-${alert.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <Bell
                  className={`h-5 w-5 mt-0.5 ${
                    alert.status === "firing"
                      ? "text-red-500"
                      : "text-green-500"
                  }`}
                />
                <div>
                  <h4 className="font-medium flex items-center gap-2">
                    {alert.title}
                    <Badge
                      variant={
                        alert.status === "firing" ? "destructive" : "default"
                      }
                    >
                      {alert.status}
                    </Badge>
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    {alert.condition}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Triggered {alert.triggered} • Severity: {alert.severity}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-acknowledge-alert-${alert.id}`}
              >
                Acknowledge
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function IncidentsContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const incidents = [
    {
      id: 1,
      title: "Database Outage",
      status: "resolved",
      severity: "critical",
      startedAt: "2024-10-29 14:30",
      duration: "2h 15m",
      assignee: "John Doe",
    },
    {
      id: 2,
      title: "API Performance Degradation",
      status: "investigating",
      severity: "high",
      startedAt: "2024-10-30 09:00",
      duration: "3h 45m",
      assignee: "Jane Smith",
    },
    {
      id: 3,
      title: "Login Service Slow",
      status: "monitoring",
      severity: "medium",
      startedAt: "2024-10-30 16:20",
      duration: "45m",
      assignee: "Bob Wilson",
    },
  ];

  const filtered = incidents.filter((i) =>
    i.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {filtered.map((incident) => (
        <Card
          key={incident.id}
          className="hover-elevate"
          data-testid={`card-incident-${incident.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap
                    className={`h-4 w-4 ${
                      incident.severity === "critical"
                        ? "text-red-500"
                        : incident.severity === "high"
                        ? "text-orange-500"
                        : "text-yellow-500"
                    }`}
                  />
                  {incident.title}
                </CardTitle>
                <CardDescription className="mt-1">
                  Started at {incident.startedAt} • Duration:{" "}
                  {incident.duration}
                </CardDescription>
              </div>
              <Badge
                variant={
                  incident.status === "resolved"
                    ? "default"
                    : incident.status === "investigating"
                    ? "destructive"
                    : "secondary"
                }
              >
                {incident.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
              <span>Assignee: {incident.assignee}</span>
              <Badge variant="outline">{incident.severity}</Badge>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-incident-${incident.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View Details
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ValueStreamAnalyticsContent({ projectName }: { projectName: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: "Lead Time",
            value: "3.2 days",
            change: "-12%",
            icon: Clock,
          },
          {
            label: "Cycle Time",
            value: "1.8 days",
            change: "-8%",
            icon: Activity,
          },
          {
            label: "Deployment Frequency",
            value: "12/week",
            change: "+25%",
            icon: Rocket,
          },
        ].map((metric, idx) => (
          <Card key={idx} data-testid={`card-vsm-metric-${idx}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <metric.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {metric.label}
                </span>
              </div>
              <div className="text-2xl font-bold">{metric.value}</div>
              <Badge
                variant={
                  metric.change.startsWith("+") ? "default" : "secondary"
                }
                className="mt-2"
              >
                {metric.change}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Value Stream Map</CardTitle>
          <CardDescription>
            End-to-end software delivery process
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center border rounded-lg bg-muted/20">
            <div className="text-center space-y-2">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Interactive value stream visualization
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// REQUIREMENTS & ANALYSIS PHASE COMPONENTS
function EpicsContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
  integrationType,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
  integrationType?: string;
}) {
  const { toast } = useToast();

  const {
    data: epics = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: [
      integrationType === "jira"
        ? `/api/sdlc/projects/${projectId}/jira/epics`
        : `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics`,
    ],
  });

  const filtered = epics.filter((e) =>
    e.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading epics...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load epics
            </p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-retry-epics"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Target className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? "No epics found matching your search"
              : "No epics yet. Create one to get started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((epic) => (
        <Card
          key={epic.id}
          className="hover-elevate"
          data-testid={`card-epic-${epic.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  {epic.title}
                </CardTitle>
                {epic.description && (
                  <CardDescription className="mt-1">
                    {epic.description}
                  </CardDescription>
                )}
                {epic.featureCount !== undefined && (
                  <CardDescription className="mt-1">
                    {epic.featureCount} features
                  </CardDescription>
                )}
              </div>
              <Badge
                variant={
                  epic.status === "completed"
                    ? "default"
                    : epic.status === "in-progress"
                    ? "secondary"
                    : "outline"
                }
              >
                {epic.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {epic.priority && (
              <div className="mb-3">
                <Badge
                  variant={
                    epic.priority === "high"
                      ? "destructive"
                      : epic.priority === "medium"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {epic.priority} priority
                </Badge>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast({
                    title: "View Epic",
                    description: `Opening details for: ${epic.title}`,
                  })
                }
                data-testid={`button-view-epic-${epic.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  toast({
                    title: "Edit Epic",
                    description: `Opening editor for: ${epic.title}`,
                  })
                }
                data-testid={`button-edit-epic-${epic.id}`}
              >
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// WorkItem interface matching hub-artifacts
interface WorkItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  linkedItems?: WorkItem[];
  source?: "ADO" | "DB";
  dbArtifact?: any;
  dbArtifactType?: "Epic" | "Feature" | "User Story";
  createdDate?: string | null;
  description?: string;
  acceptanceCriteria?: any[];
  subtasks?: any[];
  assignedTo?: string;
  storyPoints?: number | string;
  content?: string;
  category?: string;
}

type WorkItemTab = "all" | "epic" | "feature" | "user-story" | "task" | "bug" | "issue" | "linked" | "testcase";
type SourceFilter = "all" | "ado" | "draft";

function UserStoriesContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
  artifactOrgId,
  organizationUrl,
  integrationType,
}: {
  projectId: string;
  projectName?: string;
  artifactOrgId?: string;
  organizationUrl?: string;
  integrationType?: string;
}) {
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState<WorkItemTab>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [workItemFilterQuery, setWorkItemFilterQuery] = useState(searchQuery || "");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedParent, setSelectedParent] = useState<WorkItem | null>(null);
  const [selectedChildren, setSelectedChildren] = useState<WorkItem[]>([]);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingWorkItemId, setEditingWorkItemId] = useState<string | null>(null);
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [pushingToADO, setPushingToADO] = useState<string | null>(null);
  // Sync search query prop with local state
  useEffect(() => {
    if (searchQuery !== undefined) {
      setWorkItemFilterQuery(searchQuery);
    }
  }, [searchQuery]);

  // Use projectName if available, otherwise try to construct from projectId
  // This ensures the query runs even if projectName is not explicitly provided
  const effectiveProjectName = projectName || projectId;
  
  const { data: workItems = [], isLoading: isLoadingWorkItems, error: workItemsError } = useQuery<WorkItem[]>({
    queryKey:
      integrationType === "jira"
        ? [`/api/sdlc/projects/${projectId}/jira/development/work-items`]
        : effectiveProjectName
        ? [
            `/api/hub/artifacts/${effectiveProjectName}/work-items`,
            artifactOrgId,
            organizationUrl,
          ]
        : [],
    enabled: !!effectiveProjectName || !!projectId,
    queryFn: async () => {
      if (!effectiveProjectName) return [];
      try {
        const params = new URLSearchParams();
        let url = "";

        if (integrationType === "jira") {
          url = `/api/sdlc/projects/${projectId}/jira/development/work-items`;
        } else {
          if (artifactOrgId) {
            params.append("artifactOrgId", artifactOrgId);
          } else if (organizationUrl) {
            params.append("organizationUrl", organizationUrl);
          }
          url = `/api/hub/artifacts/${effectiveProjectName}/work-items${
            params.toString() ? `?${params.toString()}` : ""
          }`;
        }

        const response = await apiRequest("GET", url);
        const data = (await response.json()) as WorkItem[];
        console.log("[User Stories] Fetched ADO work items:", { count: data.length, projectName: effectiveProjectName });
        return data;
      } catch (error) {
        console.error("[User Stories] Error fetching ADO work items:", error);
        return [];
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  // Fetch workflow artifacts (same as hub-artifacts) - this is the main source of DB items
  const { data: workflowArtifactsData } = useQuery<any>({
    queryKey: ["/api/workflow/artifacts", projectId],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "saved",
        page: "1",
        limit: "50",
      });
      if (projectId) {
        params.append("projectId", projectId);
      }
      const response = await apiRequest(
        "GET",
        `/api/workflow/artifacts?${params.toString()}`
      );
      return (await response.json()) as any;
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    throwOnError: false,
  });

  // Extract latest workflow artifact for the selected project
  const workflowArtifactsForProject = workflowArtifactsData?.artifacts ?? [];
  const latestWorkflowArtifact = workflowArtifactsForProject?.[0] ?? null;

  const workflowEpics: any[] = Array.isArray(latestWorkflowArtifact?.epics)
    ? (latestWorkflowArtifact?.epics as any[])
    : [];
  const workflowFeatures: any[] = Array.isArray(
    latestWorkflowArtifact?.features
  )
    ? (latestWorkflowArtifact?.features as any[])
    : [];
  const workflowUserStories: any[] = Array.isArray(
    latestWorkflowArtifact?.userStories
  )
    ? (latestWorkflowArtifact?.userStories as any[])
    : [];

  // Also fetch from SDLC phase-specific endpoints as fallback
  const { data: localBacklog = [], isLoading: isLoadingBacklog } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog`],
    retry: false,
    throwOnError: false,
  });

  const { data: epics = [], isLoading: isLoadingEpics } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics`],
    retry: false,
    throwOnError: false,
  });

  const { data: features = [], isLoading: isLoadingFeatures } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/features`],
      retry: false,
    throwOnError: false,
  });

  const isLoading = isLoadingWorkItems || isLoadingBacklog || isLoadingEpics || isLoadingFeatures;

  // Build DB-only work items and merge with ADO items (same pattern as hub-artifacts)
  const combinedWorkItems: WorkItem[] = useMemo(() => {
    // Transform ADO items to ensure they have source="ADO"
    const adoItems: WorkItem[] = workItems.map((item) => ({
      ...item,
      source: (item.source ?? "ADO") as "ADO",
    }));

    // Use workflow artifacts as primary source (same as hub-artifacts)
    // If no workflow artifacts, fall back to SDLC phase endpoints
    const hasWorkflowArtifacts = latestWorkflowArtifact && 
      (workflowEpics.length > 0 || workflowFeatures.length > 0 || workflowUserStories.length > 0);
    
    // If no workflow artifacts and no SDLC phase items, just return ADO items
    if (!hasWorkflowArtifacts && !epics.length && !features.length && !localBacklog.length) {
      return adoItems;
    }

    // Use workflow artifacts if available, otherwise use SDLC phase endpoints
    const dbEpics = hasWorkflowArtifacts ? workflowEpics : epics;
    const dbFeatures = hasWorkflowArtifacts ? workflowFeatures : features;
    const dbStories = hasWorkflowArtifacts ? workflowUserStories : localBacklog;

    // Filter workflow artifacts to only those not yet pushed to ADO (same as hub-artifacts)
    const unpushedEpics = hasWorkflowArtifacts 
      ? dbEpics.filter((epic: any) => !epic.adoWorkItemId && !epic.adoId)
      : dbEpics;
    const unpushedFeatures = hasWorkflowArtifacts
      ? dbFeatures.filter((feature: any) => !feature.adoWorkItemId && !feature.adoId)
      : dbFeatures;
    const unpushedStories = hasWorkflowArtifacts
      ? dbStories.filter((story: any) => {
          // If story has no ADO ID, it's unpushed
          if (!story.adoWorkItemId && !story.adoId) return true;
          // If story has ADO ID but also has pushedTasks array, it means only some tasks were pushed
          if (story.adoWorkItemId && Array.isArray(story.pushedTasks)) {
            const totalTasks = Array.isArray(story.subtasks) ? story.subtasks.length : 0;
            return story.pushedTasks.length < totalTasks;
          }
          return false;
        })
      : dbStories;

    // Build DB items from workflow artifacts or SDLC phase data
    const epicMap = new Map<string, WorkItem>();
    const featureMap = new Map<string, WorkItem>();
    const storyMap = new Map<string, WorkItem>();

    // Create epic-level DB items
    unpushedEpics.forEach((epic: any) => {
      const dbEpic: WorkItem = {
        id: `db-epic-${epic.id}`,
        title: epic.title || "Untitled",
        type: "Epic",
        status: epic.status || "Backlog",
        priority: epic.priority || "Medium",
        linkedItems: [],
        source: "DB",
        dbArtifact: epic,
        dbArtifactType: "Epic",
      };
      epicMap.set(epic.id, dbEpic);
    });

    // Create feature-level DB items
    unpushedFeatures.forEach((feature: any) => {
      const dbFeature: WorkItem = {
        id: `db-feature-${feature.id}`,
        title: feature.title || "Untitled",
        type: "Feature",
        status: feature.status || "Backlog",
        priority: feature.priority || "Medium",
        linkedItems: [],
        source: "DB",
        dbArtifact: feature,
        dbArtifactType: "Feature",
      };
      featureMap.set(feature.id, dbFeature);

      // Attach to epic if epic exists
      const parentEpic = feature.epicId ? epicMap.get(feature.epicId) : null;
      if (parentEpic) {
        (parentEpic.linkedItems ||= []).push(dbFeature);
      }
    });

    // Create user story-level DB items
    unpushedStories.forEach((story: any) => {
      // Build task-level work items from story subtasks (same as hub-artifacts)
      const pushedTasks = Array.isArray((story as any).pushedTasks)
        ? (story as any).pushedTasks
        : [];
      const allTaskItems: WorkItem[] = Array.isArray((story as any).subtasks)
        ? ((story as any).subtasks as any[]).map(
            (subtask: any, idx: number): WorkItem => {
              const subtaskTitle = typeof subtask === "string" 
                ? subtask 
                : (subtask?.title || subtask?.description || `Task ${idx + 1}`);
    return {
                id: `db-task-${story.id}-${idx}`,
                title: subtaskTitle,
                type: "Task",
                status: (story as any).status || "Backlog",
                priority: story.priority || "Medium",
                linkedItems: [],
                source: "DB" as const,
              };
            }
          )
        : [];
      const taskItems = allTaskItems.filter(
        (_, idx: number) => !pushedTasks.includes(idx)
      );

      const dbStory: WorkItem = {
        id: `db-story-${story.id}`,
        title: story.title || "Untitled",
        type: "User Story",
        status: story.status || "Backlog",
        priority: story.priority || "Medium",
        linkedItems: taskItems,
        source: "DB",
        dbArtifact: story,
        dbArtifactType: "User Story",
      };
      storyMap.set(story.id, dbStory);

      const parentFeature = story.featureId ? featureMap.get(story.featureId) : null;
      const parentEpic = !parentFeature && story.epicId ? epicMap.get(story.epicId) : null;

      if (parentFeature) {
        (parentFeature.linkedItems ||= []).push(dbStory);
      } else if (parentEpic) {
        (parentEpic.linkedItems ||= []).push(dbStory);
      }
    });

    // Collect DB root items (same logic as hub-artifacts)
    const dbRootItems: WorkItem[] = [];
    epicMap.forEach((epicItem) => dbRootItems.push(epicItem));
    
    unpushedFeatures.forEach((feature: any) => {
      const featureItem = featureMap.get(feature.id);
      if (featureItem) {
        // Check if this feature is already attached to an unpushed epic
        const isAttachedToUnpushedEpic =
          feature.epicId && epicMap.has(feature.epicId);
        // Add as root item if no epic parent or epic parent was pushed
        if (!feature.epicId || !isAttachedToUnpushedEpic) {
          dbRootItems.push(featureItem);
        }
      }
    });

    unpushedStories.forEach((story: any) => {
      const hasFeatureParent = story.featureId
        ? featureMap.has(story.featureId)
        : false;
      const hasEpicParent = story.epicId ? epicMap.has(story.epicId) : false;
      // Add as root item if not attached to an unpushed parent
      if (!hasFeatureParent && !hasEpicParent) {
        const existingStory = storyMap.get(story.id);
        if (existingStory) {
          dbRootItems.push(existingStory);
        }
      }
    });

    // Deduplicate DB items that match ADO items by title
    const buildKey = (wi: WorkItem) => wi.title.trim().toLowerCase();
    const adoKeys = new Set(adoItems.map(buildKey));

    const dedupeDbItems = (items: WorkItem[]): WorkItem[] => {
      const result: WorkItem[] = [];
      for (const wi of items) {
        const key = buildKey(wi);
        if (adoKeys.has(key)) continue;
        let cleanedLinkedItems = wi.linkedItems;
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          cleanedLinkedItems = dedupeDbItems(wi.linkedItems);
        }
        result.push({
          ...wi,
          linkedItems: cleanedLinkedItems && cleanedLinkedItems.length > 0 ? cleanedLinkedItems : cleanedLinkedItems && cleanedLinkedItems.length === 0 ? [] : wi.linkedItems,
        });
      }
      return result;
    };

    const dedupedDbRoots = dedupeDbItems(dbRootItems);
    return [...adoItems, ...dedupedDbRoots];
  }, [workItems, latestWorkflowArtifact, workflowEpics, workflowFeatures, workflowUserStories, epics, features, localBacklog]);

  // Items filtered by tab + search (but before ADO/Draft source filter)
  const baseFilteredWorkItems = useMemo(() => {
    let baseItems: WorkItem[];
    const query = workItemFilterQuery.trim().toLowerCase();

    if (selectedTab === "all") {
      if (!query) {
        if (integrationType === "jira") {
          baseItems = combinedWorkItems;
        } else {
          baseItems = combinedWorkItems.filter((item) => item.type === "Epic");
        }
    } else {
        const matchedItems: WorkItem[] = [];
        const collectMatchesDeep = (item: WorkItem) => {
          const matchesSelf = item.id.toLowerCase().includes(query) || item.title.toLowerCase().includes(query);
          if (matchesSelf) matchedItems.push(item);
          if (item.linkedItems && item.linkedItems.length > 0) {
            item.linkedItems.forEach(collectMatchesDeep);
          }
        };
        combinedWorkItems.forEach(collectMatchesDeep);
        baseItems = matchedItems;
      }
    } else if (selectedTab === "linked") {
      const allLinkedItems: WorkItem[] = [];
      const collectLinkedItems = (item: WorkItem) => {
        if (item.linkedItems && item.linkedItems.length > 0) {
          allLinkedItems.push(...item.linkedItems);
          item.linkedItems.forEach(collectLinkedItems);
        }
      };
      combinedWorkItems.forEach((item) => {
        if (item.linkedItems && item.linkedItems.length > 0) {
          collectLinkedItems(item);
        }
      });
      const seen = new Set<string>();
      baseItems = allLinkedItems.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    } else {
      const typeMapping: Record<string, string> = {
        epic: "Epic",
        feature: "Feature",
        "user-story": "User Story",
        bug: "Bug",
        task: "Task",
        issue: "Issue",
        testcase: "Test Case",
      };
      const targetType = typeMapping[selectedTab];
      if (!targetType) {
        baseItems = combinedWorkItems;
      } else {
        const filterByType = (item: WorkItem): WorkItem | null => {
          const filteredLinkedItems = item.linkedItems
            ? item.linkedItems.map(filterByType).filter((li): li is WorkItem => li !== null)
            : [];
          if (item.type === targetType) {
            return { ...item, linkedItems: filteredLinkedItems };
          }
          return null;
        };
        const collectMatchesDeep = (items: WorkItem[] | WorkItem) => {
          if (Array.isArray(items)) {
            items.forEach((it) => collectMatchesDeep(it));
          } else {
            const filtered = filterByType(items);
            if (filtered) baseItems.push(filtered);
            if (items.linkedItems) {
              items.linkedItems.forEach((li) => collectMatchesDeep(li));
            }
          }
        };
        baseItems = [];
        combinedWorkItems.forEach((it) => collectMatchesDeep(it));
      }
    }

    if (!query) return baseItems;
    return baseItems.filter((item) => {
      const matchesId = item.id.toLowerCase().includes(query);
      const matchesTitle = item.title.toLowerCase().includes(query);
      return matchesId || matchesTitle;
    });
  }, [combinedWorkItems, selectedTab, workItemFilterQuery]);

  // Counts for All/ADO/Draft
  const sourceCounts = useMemo(() => {
    let ado = 0;
    let draft = 0;
    baseFilteredWorkItems.forEach((item) => {
      if (item.source === "DB") {
        draft += 1;
      } else {
        ado += 1;
      }
    });
    return {
      all: baseFilteredWorkItems.length,
      ado,
      draft,
    };
  }, [baseFilteredWorkItems]);

  // Apply ADO/Draft source filter
  const filteredWorkItems = useMemo(() => {
    let items = baseFilteredWorkItems;
    if (sourceFilter === "ado") {
      items = items.filter((item) => item.source !== "DB");
    } else if (sourceFilter === "draft") {
      items = items.filter((item) => item.source === "DB");
    }
    return items;
  }, [baseFilteredWorkItems, sourceFilter]);

  // Helper functions to find items in the combined tree
  const findParentInCombined = (targetId: string): WorkItem | null => {
    const search = (items: WorkItem[]): WorkItem | null => {
      for (const wi of items) {
        if (wi.linkedItems && wi.linkedItems.some((child) => child.id === targetId)) {
          return wi;
        }
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          const nested = search(wi.linkedItems);
          if (nested) return nested;
        }
      }
      return null;
    };
    return search(combinedWorkItems);
  };

  const findItemInCombined = (targetId: string): WorkItem | null => {
    const search = (items: WorkItem[]): WorkItem | null => {
      for (const wi of items) {
        if (wi.id === targetId) return wi;
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          const nested = search(wi.linkedItems);
          if (nested) return nested;
        }
      }
      return null;
    };
    return search(combinedWorkItems);
  };

  const toggleExpand = (itemId: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  // Handle viewing work item details
  const handleViewWorkItemDetails = (item: WorkItem) => {
    console.log("[User Stories] Viewing work item:", item);
    
    // Find parent and children in the combined tree
    const parent = findParentInCombined(item.id);
    const fullItem = findItemInCombined(item.id) || item;
    const children = fullItem.linkedItems || [];
    
    setSelectedParent(parent);
    setSelectedChildren(children);
    
    if (item.source === "DB") {
      // For DB items, extract data from dbArtifact
      const dbArtifact = item.dbArtifact;
      if (!dbArtifact) {
        console.warn("[User Stories] DB item has no dbArtifact:", item);
        return;
      }
      
      // Map the dbArtifact to the format expected by WorkItemDetailsDialog
      const itemData = {
        id: item.id,
        title: item.title || dbArtifact.title || "Untitled",
        description: dbArtifact.description || item.description || "",
        status: item.status || dbArtifact.status || "Backlog",
        priority: item.priority || dbArtifact.priority || "Medium",
        type: item.type || dbArtifact.type || "User Story",
        storyPoints: dbArtifact.storyPoints || item.storyPoints || null,
        assignedTo: dbArtifact.assignedTo || item.assignedTo || "",
        createdAt: dbArtifact.createdAt || dbArtifact.created_at || null,
        acceptanceCriteria: dbArtifact.acceptanceCriteria || dbArtifact.acceptance_criteria || [],
        subtasks: dbArtifact.subtasks || [],
        content: dbArtifact.content || "",
        category: dbArtifact.category || "",
        _originalItem: dbArtifact,
        _isAdoItem: false,
      };
      console.log("[User Stories] Setting DB item for details:", itemData);
      setSelectedItem(itemData);
      setDetailsDialogOpen(true);
      return;
    }
    
    // For ADO items, the API returns WorkItems that may need additional details fetched
    // For now, use what we have and let the dialog handle missing fields
    if (!effectiveProjectName) {
      console.warn("[User Stories] Cannot view ADO item: no project name");
      return;
    }
    
    setDetailsLoadingId(item.id);
    
    // Map ADO WorkItem to the format expected by WorkItemDetailsDialog
    // The WorkItem from the API should already have the basic fields
    // If it has nested fields (raw ADO format), extract them
    const originalItem = (item as any)._originalItem || item;
    const fields = originalItem?.fields || {};
    
    // Helper to extract field value
    const getField = (key: string, fallback: any = null) => {
      if (fields && fields[key]) return fields[key];
      if ((item as any)[key]) return (item as any)[key];
      return fallback;
    };
    
    // Handle assignedTo which might be an object
    const assignedToValue = item.assignedTo || 
                           (fields?.["System.AssignedTo"]?.displayName) ||
                           (typeof fields?.["System.AssignedTo"] === "string" ? fields["System.AssignedTo"] : "") ||
                           "";
    
    const itemData = {
      id: item.id,
      title: item.title || getField("System.Title", "Untitled"),
      description: item.description || getField("System.Description", ""),
      status: item.status || getField("System.State", "New"),
      priority: item.priority || getField("Microsoft.VSTS.Common.Priority", "Medium"),
      type: item.type || getField("System.WorkItemType", "User Story"),
      storyPoints: item.storyPoints || getField("Microsoft.VSTS.Scheduling.StoryPoints", null),
      assignedTo: assignedToValue,
      createdAt: item.createdDate || getField("System.CreatedDate", null),
      acceptanceCriteria: item.acceptanceCriteria || getField("Microsoft.VSTS.Common.AcceptanceCriteria", []),
      subtasks: item.subtasks || [],
      content: item.content || "",
      category: item.category || getField("System.Category", ""),
      _originalItem: originalItem,
      _isAdoItem: true,
    };
    
    console.log("[User Stories] Setting ADO item for details:", itemData);
    setSelectedItem(itemData);
    setDetailsDialogOpen(true);
    // Clear loading after a short delay
    setTimeout(() => setDetailsLoadingId(null), 1000);
  };

  // Handle editing work item
  const handleEditWorkItem = async (item: WorkItem) => {
    if (item.source === "DB") {
      // For DB items, use existing edit dialog
      setSelectedItem({
        ...item,
        _originalItem: item.dbArtifact,
        _isAdoItem: false,
      });
      setEditDialogOpen(true);
      return;
    }
    // For ADO items, open edit dialog
    setEditingWorkItemId(item.id);
    setSelectedItem({
      ...item,
      _originalItem: item,
      _isAdoItem: true,
    });
    setEditDialogOpen(true);
    setEditingWorkItemId(null);
  };

  // Handle pushing draft items to Azure DevOps
  const handlePushToADO = async (item: WorkItem) => {
    if (!effectiveProjectName || !latestWorkflowArtifact) {
      toast({
        title: "Error",
        description: "Cannot push: Missing project or artifact data",
        variant: "destructive",
      });
      return;
    }

    // Tasks don't have dbArtifact, they're subtasks of user stories
    if (item.type !== "Task" && !item.dbArtifact) {
      toast({
        title: "Error",
        description: "Cannot push: Missing artifact data",
        variant: "destructive",
      });
      return;
    }

    setPushingToADO(item.id);

    try {
      // Determine the type - tasks don't have dbArtifact, they're linked to stories
      let type: "epic" | "feature" | "story" | "task";
      if (item.type === "Task") {
        type = "task";
      } else if (item.dbArtifactType) {
        type =
          item.dbArtifactType === "Epic"
            ? "epic"
            : item.dbArtifactType === "Feature"
            ? "feature"
            : "story";
      } else {
        type =
          item.type === "Epic"
            ? "epic"
            : item.type === "Feature"
            ? "feature"
            : "story";
      }

      // Get all artifacts from the workflow artifact
      const epics = latestWorkflowArtifact.epics || [];
      const features = latestWorkflowArtifact.features || [];
      const userStories = latestWorkflowArtifact.userStories || [];

      // Extract the actual artifact ID from the dbArtifact or item ID
      let artifactId: string;
      if (type === "task") {
        // For tasks, use the full task ID (db-task-{storyId}-{idx})
        artifactId = item.id;
      } else if (item.dbArtifact?.id) {
        artifactId = item.dbArtifact.id;
      } else {
        // Fallback: extract from synthetic ID format (db-epic-{id}, db-feature-{id}, etc.)
        const match = item.id.match(/^db-(epic|feature|story|task)-(.+)$/);
        if (match) {
          artifactId = match[2];
        } else {
          artifactId = item.id;
        }
      }

      // Build the request payload with hierarchical push logic
      // Payload enhancement ONLY: include BRD and requirement traceability when available
      const pushBody: any = {
        projectName: effectiveProjectName,
        organization: "", // Will be determined from artifactOrgId or organizationUrl
        artifactOrgId: artifactOrgId,
        organizationUrl: organizationUrl,
        selectedItem: {
          type,
          id: artifactId,
        },
        epics,
        features,
        userStories,
        artifactId: latestWorkflowArtifact.id,
      };

      // Attach BRD and requirement traceability from the latest workflow artifact if present.
      if ((latestWorkflowArtifact as any).brdId) {
        pushBody.brdId = (latestWorkflowArtifact as any).brdId;
      } else {
        pushBody.brdId = null;
      }

      if (Array.isArray((latestWorkflowArtifact as any).requirementIds)) {
        pushBody.requirementIds = (latestWorkflowArtifact as any).requirementIds;
      } else {
        pushBody.requirementIds = [];
      }

      const pushEndpoint = integrationType === "jira"
        ? `/api/hub/artifacts/push-to-jira`
        : `/api/hub/artifacts/push-to-ado`;
      const response = await apiRequest(
        "POST",
        pushEndpoint,
        pushBody
      );

      let result = await response.json();

      // Async-job pattern (Jira only): backend returns 202 + jobId for the
      // hub artifacts Jira push; poll until completion to dodge the 29s
      // gateway timeout that otherwise surfaces as a 503.
      if (integrationType === "jira" && response.status === 202 && result?.jobId) {
        result = await pollAsyncJob<typeof result>('hub-artifacts-push-to-jira', result.jobId);
      }

      if (result.success) {
        toast({
          title: "Success",
          description: result.message || `Successfully pushed to ${integrationType === "jira" ? "Jira" : "Azure DevOps"}`,
        });
        // Refresh the work items and workflow artifacts
        queryClient.invalidateQueries({
          queryKey: effectiveProjectName
            ? [
                `/api/hub/artifacts/${effectiveProjectName}/work-items`,
                artifactOrgId,
                organizationUrl,
              ]
            : [],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/workflow/artifacts", projectId],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/workflow/artifacts"],
        });
        // Invalidate SDLC phase-specific queries to refresh counts and data immediately
        queryClient.invalidateQueries({
          queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog`],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics`],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/features`],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/sdlc/projects/${projectId}/details`],
        });
      } else {
        toast({
          title: "Error",
          description: result.error || `Failed to push to ${integrationType === "jira" ? "Jira" : "Azure DevOps"}`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `Failed to push to ${integrationType === "jira" ? "Jira" : "Azure DevOps"}`,
        variant: "destructive",
      });
    } finally {
      setPushingToADO(null);
    }
  };

  // Render work item tree (matching hub-artifacts pattern)
  const renderWorkItemTree = (item: WorkItem, level = 0, parentId?: string) => {
    const hasLinkedItems = item.linkedItems && item.linkedItems.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isDetailsLoading = detailsLoadingId === item.id;
    const typeInitial = getWorkItemTypeInitial(item.type);
    const isDraftItem = item.source === "DB";

    return (
      <div key={item.id} className="space-y-2">
        <div
          className={cn(
            "flex items-center gap-2 p-3 rounded-md border hover-elevate overflow-hidden transition-all cursor-pointer"
          )}
          style={level > 0 ? { paddingLeft: `${level * 2 + 0.75}rem` } : undefined}
          data-testid={`work-item-${item.id}`}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            const isButton = target.closest("button") || target.closest('[role="button"]');
            if (!isButton) {
              handleViewWorkItemDetails(item);
            }
          }}
        >
          {hasLinkedItems ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 p-0 hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(item.id);
                }}
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5 text-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-foreground" />
                )}
              </Button>
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${getWorkItemIconColors(item.type)}`}>
                {typeInitial}
              </div>
            </>
          ) : (
            <>
              <div className="w-8 flex-shrink-0" />
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${getWorkItemIconColors(item.type)}`}>
                {typeInitial}
              </div>
            </>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">
                {item.type}
              </Badge>
              <Badge
                variant={item.priority === "High" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {item.priority}
              </Badge>
              {item.source === "DB" ? (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-500/50 text-amber-500 bg-amber-500/10"
                >
                  Draft
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-xs border-blue-500/50 text-blue-500 bg-blue-500/10"
                >
                  {integrationType === "jira" ? "Jira" : "ADO"}
                </Badge>
              )}
          </div>
            <p className="text-sm font-medium line-clamp-3">{item.title}</p>
        </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleViewWorkItemDetails(item);
            }}
            data-testid={`button-view-${item.id}`}
            title="View work item"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={editingWorkItemId === item.id}
            onClick={(e) => {
              e.stopPropagation();
              handleEditWorkItem(item);
            }}
            data-testid={`button-edit-${item.id}`}
            title="Edit work item"
          >
            <Edit className="h-4 w-4" />
          </Button>
          {item.source === "DB" && (
            <Button
              variant="ghost"
              size="icon"
              disabled={
                pushingToADO === item.id ||
                (item.type !== "Task" && !item.dbArtifact)
              }
              onClick={(e) => {
                e.stopPropagation();
                handlePushToADO(item);
              }}
              data-testid={`button-push-ado-${item.id}`}
              title={`Push to ${integrationType === "jira" ? "Jira" : "Azure DevOps"}`}
            >
              {pushingToADO === item.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
          )}
          </div>
        {hasLinkedItems && isExpanded && (
          <div className="space-y-2">
            {item.linkedItems!.map((linkedItem) =>
              renderWorkItemTree(linkedItem, level + 1, item.id)
            )}
        </div>
        )}
      </div>
    );
  };


  // Debug logging
  useEffect(() => {
    console.log("[User Stories] Component state:", {
      projectName,
      effectiveProjectName,
      projectId,
      phaseNumber,
      artifactOrgId,
      organizationUrl,
      workItemsCount: workItems.length,
      workflowEpicsCount: workflowEpics.length,
      workflowFeaturesCount: workflowFeatures.length,
      workflowUserStoriesCount: workflowUserStories.length,
      hasWorkflowArtifact: !!latestWorkflowArtifact,
      localBacklogCount: localBacklog.length,
      epicsCount: epics.length,
      featuresCount: features.length,
      isLoading,
      isLoadingWorkItems,
      workItemsError: workItemsError?.message,
    });
  }, [projectName, effectiveProjectName, projectId, phaseNumber, workItems.length, workflowEpics.length, workflowFeatures.length, workflowUserStories.length, latestWorkflowArtifact, localBacklog.length, epics.length, features.length, isLoading, isLoadingWorkItems, workItemsError]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="ml-3 text-sm text-muted-foreground">Loading work items...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Card className="flex flex-col h-full">
        <CardContent className="p-0 flex flex-col h-full">
          <Tabs
            value={selectedTab}
            onValueChange={(value) => setSelectedTab(value as WorkItemTab)}
            className="w-full flex flex-col h-full"
          >
            {/* Header Section - Matching Hub Artifacts Layout */}
            <div className="px-6 pt-6 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <TabsList className="flex gap-1 overflow-x-auto">
                <TabsTrigger value="all" data-testid="tab-all">
                  Epic
                </TabsTrigger>
                <TabsTrigger value="feature" data-testid="tab-feature">
                  Feature
                </TabsTrigger>
                <TabsTrigger value="user-story" data-testid="tab-user-story">
                  Story
                </TabsTrigger>
                <TabsTrigger value="task" data-testid="tab-task">
                  Task
                </TabsTrigger>
                <TabsTrigger value="bug" data-testid="tab-bug">
                  Bug
                </TabsTrigger>
                <TabsTrigger value="issue" data-testid="tab-issue">
                  Issue
                </TabsTrigger>
                <TabsTrigger value="linked" data-testid="tab-linked">
                  Linked
                </TabsTrigger>
                <TabsTrigger value="testcase" data-testid="tab-testcase">
                  Test Case
                </TabsTrigger>
              </TabsList>

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
                <div className="inline-flex items-center gap-2">
                  <Button
                    variant={sourceFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSourceFilter("all")}
                  >
                    All ({sourceCounts.all})
                  </Button>
                  <Button
                    variant={sourceFilter === "ado" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSourceFilter("ado")}
                  >
                    {integrationType === "jira" ? "Jira" : "ADO"} ({sourceCounts.ado})
                  </Button>
                  <Button
                    variant={sourceFilter === "draft" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSourceFilter("draft")}
                  >
                    Draft ({sourceCounts.draft})
                  </Button>
                </div>

                <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3 w-full md:w-auto">
                  <div className="relative w-full md:max-w-xs">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by ID or title..."
                      className="pl-9"
                      value={workItemFilterQuery}
                      onChange={(e) => setWorkItemFilterQuery(e.target.value)}
                      data-testid="input-search-work-items"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <TabsContent value={selectedTab} className="m-0">
              {isLoadingWorkItems ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) :
               filteredWorkItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    No work items found
                  </p>
                </div>
              ) : selectedTab === "linked" ? (
                <div className="border-t">
                  {filteredWorkItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <LinkIcon className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-muted-foreground">
                        No linked items found
                      </p>
                    </div>
                  ) : (
                    filteredWorkItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-4 border-b hover-elevate overflow-hidden transition-all cursor-pointer"
                        onClick={() => handleViewWorkItemDetails(item)}
                      >
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${getWorkItemIconColors(item.type)}`}>
                          {getWorkItemTypeInitial(item.type)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {item.type}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {item.priority}
                            </Badge>
                            {item.source === "DB" ? (
                              <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-500 bg-amber-500/10">
                                Draft
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-500 bg-blue-500/10">
                                {integrationType === "jira" ? "Jira" : "ADO"}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium">{item.title}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewWorkItemDetails(item);
                            }}
                            data-testid={`button-view-flat-${item.id}`}
                            title="View work item"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={editingWorkItemId === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditWorkItem(item);
                            }}
                            data-testid={`button-edit-flat-${item.id}`}
                            title="Edit work item"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <ScrollArea className="h-[500px] p-6">
                  <div className="space-y-3">
                    {filteredWorkItems.map((item) =>
                      renderWorkItemTree(item)
                    )}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Work Item Details Dialog */}
      {selectedItem && (
      <WorkItemDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        item={selectedItem}
        itemType={(() => {
          const type = selectedItem.type?.toLowerCase() || "";
          if (type === "epic") return "epic";
          if (type === "feature") return "feature";
          if (type === "bug") return "bug";
          if (type === "issue") return "issue";
          if (type === "task") return "task";
          if (type === "test case") return "testcase";
          return "story"; // Default to story for user stories and others
        })()}
        projectId={projectId}
        phaseNumber={phaseNumber}
        parent={selectedParent}
        children={selectedChildren}
      />
      )}

      {/* Work Item Edit Dialog */}
      {selectedItem && (
      <WorkItemEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        item={selectedItem}
        itemType={selectedItem.type?.toLowerCase() === "epic" ? "epic" : "story"}
        projectId={projectId}
        phaseNumber={phaseNumber}
        projectName={projectName}
        artifactOrgId={artifactOrgId}
        organizationUrl={organizationUrl}
      />
      )}
    </div>
  );
}

function RequirementsContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
  integrationType,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
  integrationType?: string;
}) {
  const { toast } = useToast();
  const [conversationHistory, setConversationHistory] = useState<
    Array<{ role: string; content: string; timestamp?: string }>
  >([]);
  const [requirementText, setRequirementText] = useState<string>("");
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Helper function to format message content with markdown and emojis
  const formatMessageContent = (content: string): JSX.Element => {
    console.log("🎨 Formatting message:", content.substring(0, 100)); // Debug log
    const lines = content.split("\n");
    const formattedLines: JSX.Element[] = [];

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      // H1 headers (# Title)
      if (trimmedLine.startsWith("# ")) {
        const text = trimmedLine.replace(/^#\s+/, "");
        formattedLines.push(
          <div
            key={index}
            className="text-lg font-bold mb-3 mt-2 flex items-center gap-2"
          >
            <span className="text-2xl">📋</span>
            <span>{text}</span>
          </div>
        );
      }
      // H2 headers (## Title)
      else if (trimmedLine.startsWith("## ")) {
        const text = trimmedLine.replace(/^##\s+/, "");
        const emoji = text.toLowerCase().includes("executive")
          ? "📊"
          : text.toLowerCase().includes("timeline")
          ? "⏱️"
          : text.toLowerCase().includes("status")
          ? "🎯"
          : text.toLowerCase().includes("owner")
          ? "👤"
          : text.toLowerCase().includes("team")
          ? "👥"
          : "📌";
        formattedLines.push(
          <div
            key={index}
            className="text-base font-semibold mb-2 mt-3 flex items-center gap-2 text-blue-200"
          >
            <span>{emoji}</span>
            <span>{text}</span>
          </div>
        );
      }
      // Bold text with asterisks (**text**)
      else if (trimmedLine.includes("**")) {
        const formatted = trimmedLine.split(/(\*\*.*?\*\*)/).map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            const boldText = part.replace(/\*\*/g, "");
            // Add emoji based on content
            const emoji = boldText.toLowerCase().includes("timeline")
              ? "⏱️ "
              : boldText.toLowerCase().includes("status")
              ? "📊 "
              : boldText.toLowerCase().includes("owner")
              ? "👤 "
              : boldText.toLowerCase().includes("team")
              ? "👥 "
              : "";
            return (
              <span key={i} className="font-semibold text-blue-100">
                {emoji}
                {boldText}
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        });
        formattedLines.push(
          <div key={index} className="mb-1.5">
            {formatted}
          </div>
        );
      }
      // List items (starting with - or *)
      else if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ")) {
        const text = trimmedLine.replace(/^[-*]\s+/, "");
        formattedLines.push(
          <div key={index} className="flex gap-2 mb-1 ml-4">
            <span className="text-blue-300">•</span>
            <span>{text}</span>
          </div>
        );
      }
      // Empty lines
      else if (trimmedLine === "") {
        formattedLines.push(<div key={index} className="h-2" />);
      }
      // Regular paragraphs
      else if (trimmedLine) {
        formattedLines.push(
          <div key={index} className="mb-2">
            {trimmedLine}
          </div>
        );
      }
    });

    return <div className="space-y-0.5">{formattedLines}</div>;
  };

  // Fetch workflow artifacts to get conversation history
  const {
    data: workflowArtifactsData,
    isLoading: isLoadingArtifacts,
    isError: isArtifactsError,
  } = useQuery<any>({
    queryKey: ["/api/workflow/artifacts", projectId],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "saved",
        page: "1",
        limit: "10",
      });
      if (projectId) {
        params.append("projectId", projectId);
      }

      const response = await fetch(
        getApiUrl(`/api/workflow/artifacts?${params.toString()}`),
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch workflow artifacts");
      }

      return response.json();
    },
    enabled: !!projectId,
    retry: false,
  });

  // Helper function to parse conversation text into messages
  const parseConversationText = (
    text: string
  ): Array<{ role: string; content: string }> => {
    const messages: Array<{ role: string; content: string }> = [];
    const lines = text.split("\n");
    let currentRole: string | null = null;
    let currentContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("Assistant:")) {
        // Save previous message if exists
        if (currentRole && currentContent.length > 0) {
          messages.push({
            role: currentRole,
            content: currentContent.join("\n").trim(),
          });
        }
        // Start new assistant message
        currentRole = "assistant";
        currentContent = [line.replace("Assistant:", "").trim()];
      } else if (line.startsWith("User:")) {
        // Save previous message if exists
        if (currentRole && currentContent.length > 0) {
          messages.push({
            role: currentRole,
            content: currentContent.join("\n").trim(),
          });
        }
        // Start new user message
        currentRole = "user";
        currentContent = [line.replace("User:", "").trim()];
      } else if (line && currentRole) {
        // Continue current message
        currentContent.push(line);
      }
    }

    // Add the last message
    if (currentRole && currentContent.length > 0) {
      messages.push({
        role: currentRole,
        content: currentContent.join("\n").trim(),
      });
    }

    return messages;
  };

  // Extract conversation history from workflow artifacts
  useEffect(() => {
    if (
      workflowArtifactsData?.artifacts &&
      workflowArtifactsData.artifacts.length > 0
    ) {
      const latestArtifact = workflowArtifactsData.artifacts[0];

      // Try to extract conversation history from various possible fields
      const history =
        latestArtifact.conversationHistory ||
        latestArtifact.messages ||
        latestArtifact.chatHistory ||
        latestArtifact.conversation ||
        latestArtifact.conversationMessages ||
        null;

      // Extract requirement text
      if (latestArtifact.requirement) {
        setRequirementText(latestArtifact.requirement);
      }

      if (history) {
        let messages: Array<{
          role: string;
          content: string;
          timestamp?: string;
        }> = [];

        // Handle different formats
        if (typeof history === "string") {
          try {
            const parsed = JSON.parse(history);
            if (Array.isArray(parsed)) {
              messages = parsed;
            } else {
              // If parsing fails or it's not an array, try to parse as conversation text
              messages = parseConversationText(history);
            }
          } catch (e) {
            // If not JSON, parse as conversation text with "Assistant:" and "User:" markers
            messages = parseConversationText(history);
          }
        } else if (Array.isArray(history)) {
          messages = history;
        }

        setConversationHistory(messages);
      } else if (latestArtifact.requirement) {
        // Try to parse requirement text as conversation
        const parsedMessages = parseConversationText(
          latestArtifact.requirement
        );
        if (parsedMessages.length > 0) {
          setConversationHistory(parsedMessages);
        } else {
          // If no conversation markers found, create a placeholder
          setConversationHistory([
            {
              role: "user",
              content: latestArtifact.requirement,
            },
            {
              role: "assistant",
              content:
                "I've captured your requirement. Let me help you refine it further.",
            },
          ]);
        }
      }
      setLoadingHistory(false);
    } else {
      setLoadingHistory(false);
    }
  }, [workflowArtifactsData]);

  if (isLoadingArtifacts || loadingHistory) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading conversation history...
          </p>
        </div>
      </div>
    );
  }

  if (isArtifactsError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load conversation history
            </p>
            <p className="text-xs text-muted-foreground">
              No conversation history available yet. Start a workflow to begin a
              conversation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (conversationHistory.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No conversation history yet. Start a workflow to begin gathering
            requirements.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Conversation History Container */}
      <div className="px-6 pt-6 pb-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-600" />
          Conversation History
        </h3>
      </div>

      {/* Chat Messages Container with Border */}
      <div
        className="mx-6 mb-6 flex-1 border border-border rounded-xl bg-muted/10 overflow-hidden"
        style={{ minHeight: "500px" }}
      >
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6 max-w-5xl mx-auto">
            {conversationHistory.map((message, index) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={index}
                  className={`flex gap-3 items-start ${
                    isUser ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                      isUser
                        ? "bg-blue-500 text-white"
                        : "bg-purple-600 text-white"
                    }`}
                  >
                    {isUser ? (
                      <UserCircle className="h-5 w-5" />
                    ) : (
                      <Bot className="h-5 w-5" />
                    )}
                  </div>

                  {/* Message Content */}
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <span
                      className={`text-xs font-medium ${
                        isUser ? "text-right" : "text-left"
                      } text-muted-foreground px-1`}
                    >
                      {isUser ? "You" : "Tia Bot"}
                    </span>
                    <div
                      className={`rounded-lg px-4 py-3 ${
                        isUser
                          ? "bg-blue-600 text-white ml-auto"
                          : "bg-slate-700 dark:bg-slate-800 text-white"
                      }`}
                      style={{ maxWidth: "80%" }}
                    >
                      <div className="text-sm leading-relaxed break-words">
                        {formatMessageContent(message.content)}
                      </div>
                      {message.timestamp && (
                        <p className={`text-xs mt-2 opacity-70`}>
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function BacklogContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
  integrationType,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
  integrationType?: string;
}) {
  const { toast } = useToast();
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const {
    data: backlogItems = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog`],
  });

  const filtered = backlogItems.filter((b) =>
    b.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewItem = (item: any) => {
    setSelectedItem(item);
    setDetailsDialogOpen(true);
  };

  const handleEditItem = (item: any) => {
    setSelectedItem(item);
    setEditDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading backlog items...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load backlog items
            </p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-retry-backlog"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <FolderGit2 className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? "No backlog items found matching your search"
              : "No backlog items yet. Create one to get started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((item) => (
        <Card
          key={item.id}
          className="hover-elevate"
          data-testid={`card-backlog-${item.id}`}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium">{item.title}</h4>
                {item.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.description}
                  </p>
                )}
                {(item.storyPoints || item.assignedTo) && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.storyPoints && `${item.storyPoints} points`}
                    {item.storyPoints && item.assignedTo && " • "}
                    {item.assignedTo && `Assigned to ${item.assignedTo}`}
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  {item.type && (
                    <Badge
                      variant={item.type === "bug" ? "destructive" : "default"}
                    >
                      {item.type}
                    </Badge>
                  )}
                  {item.priority && (
                    <Badge
                      variant={
                        item.priority === "high"
                          ? "destructive"
                          : item.priority === "medium"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {item.priority}
                    </Badge>
                  )}
                  {item.status && (
                    <Badge
                      variant={
                        item.status === "done"
                          ? "default"
                          : item.status === "in_progress"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {item.status}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleViewItem(item)}
                  data-testid={`button-view-backlog-${item.id}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleEditItem(item)}
                  data-testid={`button-edit-backlog-${item.id}`}
                >
                  <Edit className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Work Item Details Dialog */}
      <WorkItemDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        item={selectedItem}
        itemType="backlog"
        projectId={projectId}
        phaseNumber={phaseNumber}
      />

      {/* Work Item Edit Dialog */}
      <WorkItemEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        item={selectedItem}
        itemType="backlog"
        projectId={projectId}
        phaseNumber={phaseNumber}
      />
    </div>
  );
}

function DocumentationContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const {
    data: docs = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/documents`,
    ],
  });

  // Fetch wiki pages from workflow artifacts
  const {
    data: wikiData,
    isLoading: wikiLoading,
    isError: wikiError,
    error: wikiErrorObj,
    refetch: refetchWiki,
  } = useQuery<{ wikiPages: any[]; sessionId?: string; artifactId?: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/wiki-pages`],
    queryFn: async () => {
      try {
        const response = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/wiki-pages`),
          {
            credentials: "include",
          }
        );
        if (!response.ok) {
          console.warn(`Failed to fetch wiki pages: ${response.status}`);
          return { wikiPages: [] };
        }
        const data = await response.json();
        console.log("Wiki pages API response:", data);
        return data;
      } catch (error) {
        console.error("Error fetching wiki pages:", error);
        return { wikiPages: [] };
      }
    },
  });

  const wikiPages = wikiData?.wikiPages || [];
  const wikiSessionId = wikiData?.sessionId;

  // Combine docs and wiki pages
  const allDocuments = [
    ...docs,
    ...wikiPages.map((wp: any) => ({
      id: wp.id,
      title: wp.title,
      content: wp.content,
      type: "wiki",
      pageType: wp.pageType,
      sessionId: wp.sessionId || wikiSessionId,
      createdAt: wp.createdAt,
      updatedAt: wp.updatedAt,
    })),
  ];

  const filtered = allDocuments.filter((d) =>
    d.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewItem = (item: any) => {
    setSelectedItem(item);
    setDetailsDialogOpen(true);
  };

  const handleEditItem = (item: any) => {
    setSelectedItem(item);
    setEditDialogOpen(true);
  };

  const loading = isLoading || wikiLoading;
  const combinedError = isError || wikiError;
  const combinedErrorObj = error || wikiErrorObj;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading documents...</p>
        </div>
      </div>
    );
  }

  if (combinedError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load documents
            </p>
            <p className="text-xs text-muted-foreground">
              {combinedErrorObj instanceof Error
                ? combinedErrorObj.message
                : "An unexpected error occurred"}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                refetch();
                refetchWiki();
              }}
              data-testid="button-retry-documents"
            >
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                /* fallback: open workflow artifacts dialog? */
              }}
            >
              Open Workflow
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? "No documents found matching your search"
              : "No documentation yet. Create one to get started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filtered.map((doc) => (
        <div
          key={doc.id}
          className="group relative overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-background to-muted/20 p-4 transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 cursor-pointer"
          data-testid={`card-doc-${doc.id}`}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          <div className="relative z-10 flex items-start gap-4">
            <div className="shrink-0 pt-1">
              <div className="rounded-lg bg-primary/10 p-2.5 group-hover:bg-primary/20 transition-colors">
                <FileText className="h-5 w-5 text-primary group-hover:text-primary/80 transition-colors" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors line-clamp-2">
                    {doc.title}
                  </h4>
                  {doc.content && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2 group-hover:text-muted-foreground/80 transition-colors">
                      {doc.content.substring(0, 120)}...
                    </p>
                  )}
                  {(doc.createdAt || doc.updatedAt) && (
                    <p className="text-xs text-muted-foreground/60 mt-2">
                      Updated{" "}
                      {new Date(
                        doc.updatedAt || doc.createdAt
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>

                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full bg-primary/10 hover:bg-primary/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewItem(doc);
                    }}
                    data-testid={`button-view-doc-${doc.id}`}
                  >
                    <Eye className="h-4 w-4 text-primary" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full bg-primary/10 hover:bg-primary/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditItem(doc);
                    }}
                    data-testid={`button-edit-doc-${doc.id}`}
                  >
                    <Edit className="h-4 w-4 text-primary" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Work Item Details Dialog */}
      <WorkItemDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        item={selectedItem}
        itemType="document"
        projectId={projectId}
        phaseNumber={phaseNumber}
      />

      {/* Work Item Edit Dialog for documents */}
      <WorkItemEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        item={selectedItem}
        itemType="document"
        projectId={projectId}
        phaseNumber={phaseNumber}
      />
    </div>
  );
}

// CODE REVIEW COMPONENT
function CodeReviewContent({
  projectName,
  searchQuery,
}: {
  projectName: string;
  searchQuery: string;
}) {
  const reviews = [
    {
      id: 1,
      title: "Feature: User Authentication",
      author: "John Doe",
      status: "pending",
      files: 5,
      comments: 12,
      approvals: 2,
      date: "2024-11-03",
      description: "Added OAuth2 authentication flow with JWT tokens",
    },
    {
      id: 2,
      title: "Fix: Database Connection Pool",
      author: "Jane Smith",
      status: "approved",
      files: 3,
      comments: 5,
      approvals: 3,
      date: "2024-11-02",
      description: "Improved connection pool handling and error recovery",
    },
    {
      id: 3,
      title: "Refactor: API Response Structure",
      author: "Bob Wilson",
      status: "changes-requested",
      files: 8,
      comments: 18,
      approvals: 1,
      date: "2024-11-01",
      description: "Standardized API response format across all endpoints",
    },
  ];

  const filtered = reviews.filter(
    (r) =>
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "default";
      case "pending":
        return "secondary";
      case "changes-requested":
        return "destructive";
      default:
        return "secondary";
    }
  };

  return (
    <div className="space-y-3">
      {filtered.map((review) => (
        <Card
          key={review.id}
          className="hover-elevate"
          data-testid={`card-code-review-${review.id}`}
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-base">{review.title}</CardTitle>
                <CardDescription className="mt-1">
                  {review.description}
                </CardDescription>
              </div>
              <Badge variant={getStatusColor(review.status) as any}>
                {review.status.replace("-", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
              <span>
                {review.author} • {review.date}
              </span>
              <div className="flex items-center gap-3">
                <span>{review.files} files</span>
                <span>{review.comments} comments</span>
                <span>{review.approvals} approvals</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-view-review-${review.id}`}
              >
                <Eye className="h-3 w-3 mr-1" />
                View Changes
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-comment-review-${review.id}`}
              >
                <Edit className="h-3 w-3 mr-1" />
                Comment
              </Button>
              {review.status === "pending" && (
                <Button
                  size="sm"
                  data-testid={`button-approve-review-${review.id}`}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Approve
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// DESIGN REVIEW COMPONENT
function DesignReviewContent({
  projectId,
  projectName,
  phaseNumber,
  searchQuery,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
  searchQuery: string;
}) {
  const { toast } = useToast();
  const [selectedReview, setSelectedReview] = useState<any>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [commentText, setCommentText] = useState("");

  const {
    data: reviews = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-reviews`,
    ],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/sdlc/design-reviews/${id}`, {
        status,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-reviews`,
        ],
      });
      toast({ title: "Success", description: "Design review status updated" });
      setReviewDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const review = reviews.find((r) => r.id === id);
      const currentComments = review?.comments
        ? JSON.parse(review.comments)
        : [];
      const newComments = [
        ...currentComments,
        { text: comment, timestamp: new Date().toISOString() },
      ];
      return await apiRequest("PATCH", `/api/sdlc/design-reviews/${id}`, {
        comments: JSON.stringify(newComments),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-reviews`,
        ],
      });
      toast({ title: "Success", description: "Comment added successfully" });
      setCommentText("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add comment",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/sdlc/design-reviews/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-reviews`,
        ],
      });
      toast({
        title: "Success",
        description: "Design review deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete review",
        variant: "destructive",
      });
    },
  });

  const filtered = reviews.filter(
    (d) =>
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.description &&
        d.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "default";
      case "pending":
        return "secondary";
      case "changes-requested":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const handleViewReview = (review: any) => {
    setSelectedReview(review);
    setReviewDialogOpen(true);
  };

  const handleApprove = (id: string) => {
    updateStatusMutation.mutate({ id, status: "approved" });
  };

  const handleAddComment = () => {
    if (commentText.trim() && selectedReview) {
      addCommentMutation.mutate({
        id: selectedReview.id,
        comment: commentText.trim(),
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this design review?")) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading design reviews...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Failed to load design reviews
            </p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-retry-reviews"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Eye className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? "No design reviews found matching your search"
              : "No design reviews yet. Create one to get started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {filtered.map((review) => {
          const commentCount = review.comments
            ? JSON.parse(review.comments).length
            : 0;
          return (
            <Card
              key={review.id}
              className="hover-elevate"
              data-testid={`card-design-review-${review.id}`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-base">{review.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {review.description}
                    </CardDescription>
                  </div>
                  <Badge variant={getStatusColor(review.status) as any}>
                    {review.status.replace("-", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                  <span>{new Date(review.createdAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-3">
                    <span>{commentCount} comments</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleViewReview(review)}
                    data-testid={`button-preview-design-${review.id}`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    View
                  </Button>
                  {review.status === "pending" && (
                    <Button
                      size="sm"
                      onClick={() => handleApprove(review.id)}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-approve-design-${review.id}`}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(review.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-review-${review.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent
          className="max-w-4xl max-h-[85vh]"
          data-testid="dialog-design-review"
        >
          <DialogHeader>
            <DialogTitle>{selectedReview?.title}</DialogTitle>
          </DialogHeader>
          {selectedReview && (
            <div className="space-y-4 overflow-y-auto max-h-[70vh]">
              <div>
                <h4 className="font-medium mb-1">Description</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedReview.description}
                </p>
              </div>

              <div>
                <h4 className="font-medium mb-2">Comments</h4>
                <div className="space-y-2 mb-3">
                  {selectedReview.comments &&
                  JSON.parse(selectedReview.comments).length > 0 ? (
                    JSON.parse(selectedReview.comments).map(
                      (comment: any, idx: number) => (
                        <div key={idx} className="p-3 border rounded-lg">
                          <p className="text-sm">{comment.text}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(comment.timestamp).toLocaleString()}
                          </p>
                        </div>
                      )
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No comments yet
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Add a comment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                    data-testid="input-comment"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddComment}
                    disabled={
                      !commentText.trim() || addCommentMutation.isPending
                    }
                    data-testid="button-add-comment"
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t">
                {selectedReview.status === "pending" && (
                  <Button
                    onClick={() => handleApprove(selectedReview.id)}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-approve-review-dialog"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => setReviewDialogOpen(false)}
                  data-testid="button-close-review"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// PREVIEW COMPONENT (Development Phase)
function PreviewContent({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  // Fetch repository
  const { data: repositories = [], isLoading: isLoadingRepos } = useQuery<
    any[]
  >({
    queryKey: [`/api/sdlc/projects/${projectId}/repositories`],
    enabled: !!projectId,
  });

  const repository =
    repositories && repositories.length > 0 ? repositories[0] : null;

  // Fetch branches
  const { data: branches = [], isLoading: isLoadingBranches } = useQuery<any[]>(
    {
      queryKey: [`/api/sdlc/repositories/${repository?.id}/branches`],
      enabled: !!repository?.id,
    }
  );

  // Fetch preview data
  const { data: preview, isLoading: isLoadingPreview } = useQuery<any>({
    queryKey: [`/api/sdlc/repositories/${repository?.id}/preview`],
    enabled: !!repository?.id,
  });

  // Fetch commits
  const { data: commits = [], isLoading: isLoadingCommits } = useQuery<any[]>({
    queryKey: [`/api/sdlc/repositories/${repository?.id}/commits`],
    enabled: !!repository?.id,
  });

  // Fetch code
  const devBranch = branches.find((b: any) => b.name === "dev");
  const { data: code, isLoading: isLoadingCode } = useQuery<any>({
    queryKey: [
      `/api/sdlc/repositories/${repository?.id}/branches/${devBranch?.id}/code`,
    ],
    enabled: !!repository?.id && !!devBranch?.id,
  });

  const isLoading =
    isLoadingRepos ||
    isLoadingBranches ||
    isLoadingPreview ||
    isLoadingCommits ||
    isLoadingCode;

  // Calculate progress
  const progress = {
    repoCreated: !!repository,
    branchesCreated: branches.length >= 2,
    codeGenerated: !!code && code.length > 0,
    commitLogged: commits.length > 0,
    previewReady: !!preview,
  };

  const progressPercentage =
    (progress.repoCreated ? 20 : 0) +
    (progress.branchesCreated ? 20 : 0) +
    (progress.codeGenerated ? 30 : 0) +
    (progress.commitLogged ? 20 : 0) +
    (progress.previewReady ? 10 : 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (!repository) {
    return (
      <div className="border rounded-md p-8 text-center">
        <Eye className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          No repository found for this project.
          <br />
          Please create a repository first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Preview Details */}
      <Card data-testid="card-preview-info">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Local Preview Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-4 bg-muted/20 rounded-lg border">
            <p className="text-sm font-medium mb-2">Repository</p>
            <code className="text-sm text-primary">{repository.name}</code>
          </div>

          <div className="p-4 bg-muted/20 rounded-lg border">
            <p className="text-sm font-medium mb-2">Active Branch</p>
            <code className="text-sm text-primary">
              {devBranch?.name || "dev"}
            </code>
          </div>

          {code && code.length > 0 && (
            <div className="p-4 bg-muted/20 rounded-lg border">
              <p className="text-sm font-medium mb-2">Generated Code Files</p>
              <p className="text-sm text-muted-foreground">
                {code.length} file{code.length !== 1 ? "s" : ""} generated
              </p>
            </div>
          )}

          {commits.length > 0 && (
            <div className="p-4 bg-muted/20 rounded-lg border">
              <p className="text-sm font-medium mb-2">Latest Commit</p>
              <p className="text-sm text-muted-foreground">
                {commits[0].message}
              </p>
            </div>
          )}

          {preview && (
            <div className="p-4 bg-muted/20 rounded-lg border">
              <p className="text-sm font-medium mb-2">Preview Status</p>
              <p className="text-sm text-muted-foreground capitalize">
                {preview.status || "Ready"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// DESIGN PHASE COMPONENTS - NEW

// Custom hook for design asset caching with localStorage persistence
function useDesignAssetCache(
  projectId: string,
  phaseNumber: number,
  designCategory: string,
  assets: any[]
) {
  const storageKey = `design-asset-${designCategory}-${projectId}-phase${phaseNumber}`;
  const [cachedAsset, setCachedAsset] = useState<any>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Verify the cached data matches the expected category
        if (parsed?.designCategory === designCategory) {
          setCachedAsset(parsed);
        } else {
          // Clear mismatched cache
          localStorage.removeItem(storageKey);
        }
      }
    } catch (error) {
      console.error("Error loading from localStorage:", error);
      localStorage.removeItem(storageKey);
    }
  }, [storageKey, designCategory]);

  // Filter for the specific design category
  const freshAsset = assets.find((a) => a.designCategory === designCategory);

  // Save to localStorage when fresh asset is fetched
  useEffect(() => {
    if (freshAsset) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(freshAsset));
        setCachedAsset(freshAsset);
      } catch (error) {
        console.error("Error saving to localStorage:", error);
      }
    }
  }, [freshAsset, storageKey]);

  // Return fresh data if available, otherwise use cached
  return freshAsset || cachedAsset;
}

function SystemArchitectureContent({
  projectId,
  projectName,
  phaseNumber,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
}) {
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const { toast } = useToast();

  // Fetch design assets
  const { data: assets = [], isLoading } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
    ],
  });

  // Use custom hook for caching with localStorage persistence
  const activeAsset = useDesignAssetCache(
    projectId,
    phaseNumber,
    "system-architecture",
    assets
  );

  // Decode content from data URL
  const getDecodedContent = (asset: any) => {
    if (!asset?.fileUrl) return "";
    try {
      const base64Content = asset.fileUrl.replace(
        "data:text/markdown;base64,",
        ""
      );
      return atob(base64Content);
    } catch (error) {
      console.error("Error decoding content:", error);
      return "";
    }
  };

  const content = activeAsset ? getDecodedContent(activeAsset) : "";
  const summary = content
    ? content.substring(0, 200) + (content.length > 200 ? "..." : "")
    : "No system architecture design generated yet. Click 'Generate Design' to create one.";

  const handlePreview = () => {
    if (!activeAsset) {
      toast({
        title: "No Design Available",
        description: "Please generate a System Architecture design first.",
        variant: "destructive",
      });
      return;
    }
    setPreviewDialogOpen(true);
  };

  const handleDownload = () => {
    if (!activeAsset) {
      toast({
        title: "No Design Available",
        description: "Please generate a System Architecture design first.",
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([content], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `system_architecture_${projectName.replace(
      /\s+/g,
      "_"
    )}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <Card className="hover-elevate" data-testid="card-system-architecture">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Network className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium">System Architecture</h4>
                  <p className="text-sm text-muted-foreground">
                    {activeAsset ? "AI Generated" : "Not Generated"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePreview}
                  data-testid="button-preview-system-architecture"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  data-testid="button-download-system-architecture"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2 ml-8">{summary}</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>System Architecture Preview</DialogTitle>
            <DialogDescription>
              Architecture design for {projectName}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 h-full">
            <div className="p-6">
              {content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/20 p-4 rounded-lg border">
                    {content}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center p-8 bg-muted/20 rounded-lg border h-full">
                  <div className="text-center space-y-2">
                    <Network className="h-16 w-16 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">
                      No Architecture Design
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Generate one using the Design Phase button
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DatabaseDesignContent({
  projectId,
  projectName,
  phaseNumber,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
}) {
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const { toast } = useToast();

  // Fetch design assets
  const { data: assets = [], isLoading } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
    ],
  });

  // Use custom hook for caching with localStorage persistence
  const activeAsset = useDesignAssetCache(
    projectId,
    phaseNumber,
    "database-design",
    assets
  );

  // Decode content from data URL
  const getDecodedContent = (asset: any) => {
    if (!asset?.fileUrl) return "";
    try {
      const base64Content = asset.fileUrl.replace(
        "data:text/markdown;base64,",
        ""
      );
      return atob(base64Content);
    } catch (error) {
      console.error("Error decoding content:", error);
      return "";
    }
  };

  const content = activeAsset ? getDecodedContent(activeAsset) : "";
  const summary = content
    ? content.substring(0, 200) + (content.length > 200 ? "..." : "")
    : "No database design generated yet. Click 'Generate Design' to create one.";

  const handlePreview = () => {
    if (!activeAsset) {
      toast({
        title: "No Design Available",
        description: "Please generate a Database Design first.",
        variant: "destructive",
      });
      return;
    }
    setPreviewDialogOpen(true);
  };

  const handleDownload = () => {
    if (!activeAsset) {
      toast({
        title: "No Design Available",
        description: "Please generate a Database Design first.",
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([content], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `database_design_${projectName.replace(/\s+/g, "_")}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <Card className="hover-elevate" data-testid="card-database-design">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Database className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium">Database Design</h4>
                  <p className="text-sm text-muted-foreground">
                    {activeAsset ? "AI Generated" : "Not Generated"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePreview}
                  data-testid="button-preview-database-design"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  data-testid="button-download-database-design"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2 ml-8">{summary}</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Database Design Preview</DialogTitle>
            <DialogDescription>
              Database schema for {projectName}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 h-full">
            <div className="p-6">
              {content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/20 p-4 rounded-lg border">
                    {content}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center p-8 bg-muted/20 rounded-lg border h-full">
                  <div className="text-center space-y-2">
                    <Database className="h-16 w-16 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">No Database Design</p>
                    <p className="text-xs text-muted-foreground">
                      Generate one using the Design Phase button
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UIUXDesignContent({
  projectId,
  dbProjectId,
  projectName,
  phaseNumber,
  artifactOrgId,
  organizationUrl,
  adoProjectId,
}: {
  projectId: string;
  dbProjectId?: string;
  projectName: string;
  phaseNumber: number;
  artifactOrgId?: string;
  organizationUrl?: string;
  adoProjectId?: string;
}) {
  const { toast } = useToast();
  const [savedDesignMappings, setSavedDesignMappings] = useState<any[]>([]);
  const [projectFigmaLink, setProjectFigmaLink] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [expandedMappingId, setExpandedMappingId] = useState<string | null>(
    null
  );
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<any>(null);

  const fetchDesignMappings = async () => {
    // Use projectId (apiProjectId from parent) as primary, fallback to dbProjectId
    // This ensures we fetch for the currently selected ADO project
    const fetchProjectId = projectId || dbProjectId;
    console.log("[UI/UX Design] Props:", {
      projectId,
      dbProjectId,
      fetchProjectId,
    });
    if (!fetchProjectId) {
      console.warn("[UI/UX Design] No project ID available");
      return;
    }

    setIsLoading(true);
    try {
      console.log(
        "[UI/UX Design] Fetching saved design mappings for project:",
        fetchProjectId
      );

      const response = await fetch(
        getApiUrl(`/api/design-mapping/${fetchProjectId}`),
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        }
      );

      console.log("[UI/UX Design] Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[UI/UX Design] Response error:", errorText);
        throw new Error("Failed to fetch design mappings");
      }

      const mappings = await response.json();
      setSavedDesignMappings(mappings);
      console.log(
        `[UI/UX Design] Loaded ${mappings.length} saved design mappings:`,
        mappings
      );

      if (mappings.length === 0) {
        toast({
          title: "No Designs Found",
          description:
            "No saved UI/UX designs found. Generate designs to see them here.",
        });
      }
    } catch (error) {
      console.error("Error fetching design mappings:", error);
      toast({
        title: "Failed to Load Designs",
        description: "Could not fetch saved design mappings.",
        variant: "destructive",
      });
      setSavedDesignMappings([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProjectFigmaLink = async () => {
    const fetchProjectId = dbProjectId || projectId;
    if (!fetchProjectId) {
      console.warn("[UI/UX Design] No project ID available for Figma link");
      return;
    }

    try {
      console.log("[UI/UX Design] Fetching project Figma link for:", fetchProjectId);

      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${fetchProjectId}/design-guidelines`),
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        }
      );

      if (response.ok) {
        const guidelines = await response.json();
        const guidelineWithFigma = guidelines.find((g: any) => 
          g.figmaLink && g.figmaLink.trim().length > 0
        );

        if (guidelineWithFigma) {
          setProjectFigmaLink(guidelineWithFigma.figmaLink);
          console.log("[UI/UX Design] Project Figma link found:", guidelineWithFigma.figmaLink);
        } else {
          console.log("[UI/UX Design] No project Figma link found");
          setProjectFigmaLink("");
        }
      }
    } catch (error) {
      console.error("Error fetching project Figma link:", error);
      setProjectFigmaLink("");
    }
  };

  useEffect(() => {
    fetchDesignMappings();
    fetchProjectFigmaLink();
  }, [projectId, dbProjectId]);

  const handleViewFigma = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleToggleMapping = (mappingId: string) => {
    setExpandedMappingId(expandedMappingId === mappingId ? null : mappingId);
  };

  const handleCopyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast({
      title: "Copied!",
      description: "Figma prompt copied to clipboard",
    });
  };

  const handleCopyFigmaLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast({
      title: "Copied!",
      description: "Figma link copied to clipboard",
    });
  };

  const handleDeleteMapping = async (mappingId: string) => {
    if (!confirm("Are you sure you want to delete this design mapping?")) {
      return;
    }

    try {
      const response = await fetch(
        getApiUrl(`/api/design-mapping/${mappingId}`),
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to delete design mapping");
      }

      // Refresh the list after deletion
      setSavedDesignMappings((prev) => prev.filter((m) => m.id !== mappingId));

      toast({
        title: "Deleted",
        description: "Design mapping deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting design mapping:", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete design mapping",
        variant: "destructive",
      });
    }
  };

  const handleRegenerateClick = (mapping: any) => {
    setSelectedMapping(mapping);
    setRegenerateModalOpen(true);
  };

  const handleConfirmRegenerate = () => {
    if (selectedMapping) {
      // Find the parent SDLC component and trigger generate design
      const sdlcComponent = document.querySelector('[data-testid="sdlc-page"]');
      if (sdlcComponent) {
        // Dispatch a custom event that the SDLC page can listen to
        const event = new CustomEvent('regenerateDesign', {
          detail: {
            epicId: selectedMapping.epicId,
            epicTitle: selectedMapping.epicTitle,
            userStories: selectedMapping.userStories
          },
          bubbles: true
        });
        sdlcComponent.dispatchEvent(event);
      } else {
        // Fallback: use window event
        window.dispatchEvent(new CustomEvent('regenerateDesign', {
          detail: {
            epicId: selectedMapping.epicId,
            epicTitle: selectedMapping.epicTitle,
            userStories: selectedMapping.userStories
          }
        }));
      }
      
      toast({
        title: "Opening Generate Design",
        description: "Generate Design modal will open with selected epic and stories",
      });
    }
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <Card className="hover-elevate">
          <CardContent className="p-4">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">
                Loading saved designs...
              </p>
            </div>
          </CardContent>
        </Card>
      ) : savedDesignMappings.length === 0 ? (
        <Card className="hover-elevate">
          <CardContent className="p-4">
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <Figma className="h-12 w-12 text-muted-foreground/30" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  No Saved Designs Yet
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Generate UI/UX designs to see them here with prompts and Figma
                  links
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        savedDesignMappings.map((mapping) => {
          const isExpanded = expandedMappingId === mapping.id;

          return (
            <Card
              key={mapping.id}
              className="hover-elevate border-indigo-200 dark:border-indigo-800"
              data-testid={`card-uiux-mapping-${mapping.id}`}
            >
              <CardContent className="p-3 bg-indigo-50/30 dark:bg-indigo-950/20">
                <div
                  className="flex items-center justify-between gap-3 cursor-pointer"
                  onClick={() => handleToggleMapping(mapping.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}
                    <Flag className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium">
                        {mapping.epicTitle}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Epic #{mapping.epicId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRegenerateClick(mapping);
                      }}
                      data-testid={`button-regenerate-${mapping.id}`}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Regenerate
                    </Button>
                    {projectFigmaLink && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewFigma(projectFigmaLink);
                        }}
                        data-testid={`button-view-figma-${mapping.id}`}
                      >
                        <Figma className="h-3 w-3 mr-1" />
                        View Figma
                      </Button>
                    )}
                    {/* Delete button removed for UI/UX feature per product decision */}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-700 space-y-3">
                    {/* User Stories Section */}
                    <div className="bg-white dark:bg-gray-900 rounded-md p-3 border border-indigo-200 dark:border-indigo-700">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                        <h5 className="text-xs font-semibold">
                          User{" "}
                          {mapping.userStories?.length === 1
                            ? "Story"
                            : "Stories"}{" "}
                          ({mapping.userStories?.length || 0})
                        </h5>
                      </div>
                      <div className="space-y-1.5">
                        {mapping.userStories &&
                        mapping.userStories.length > 0 ? (
                          mapping.userStories.map(
                            (story: any, index: number) => (
                              <div
                                key={index}
                                className="flex items-start gap-2 text-xs"
                              >
                                <span className="text-muted-foreground shrink-0">
                                  #{story.id}:
                                </span>
                                <span className="font-medium flex-1">
                                  {story.title}
                                </span>
                              </div>
                            )
                          )
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No user stories
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Figma Prompt Section */}
                    {mapping.prompt && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-semibold flex items-center gap-2">
                            <Sparkles className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                            Generated Figma Prompt
                          </h5>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyPrompt(mapping.prompt)}
                            className="h-6 px-2 text-xs"
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-950/30 rounded p-3 text-xs text-muted-foreground max-h-40 overflow-y-auto border border-purple-200 dark:border-purple-800">
                          <pre className="whitespace-pre-wrap font-sans">
                            {mapping.prompt}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Extracted Guidelines Section */}
                    {mapping.prompt && (() => {
                      // More flexible regex to handle varying whitespace and newlines
                      const guidelinesMatch = mapping.prompt.match(/Custom Design Guidelines:\s*([\s\S]*?)(?=## Design Specifications|$)/);
                      const guidelines = guidelinesMatch ? guidelinesMatch[1].trim() : null;
                      
                      console.log("[UI/UX Feature] Extracting guidelines:", {
                        hasPrompt: !!mapping.prompt,
                        guidelinesFound: !!guidelines,
                        guidelinesLength: guidelines?.length || 0,
                        guidelinesPreview: guidelines?.substring(0, 150) || "(none)",
                      });
                      
                      if (guidelines && guidelines.length > 0) {
                        return (
                          <div className="space-y-2 border-t pt-3">
                            <h5 className="text-xs font-semibold flex items-center gap-2">
                              <Palette className="h-3 w-3 text-green-600 dark:text-green-400" />
                              Design Guidelines Used
                            </h5>
                            <div className="bg-green-50 dark:bg-green-950/30 rounded p-3 text-xs text-muted-foreground max-h-40 overflow-y-auto border border-green-200 dark:border-green-800">
                              <pre className="whitespace-pre-wrap font-sans">
                                {guidelines}
                              </pre>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Figma Link Section */}
                    {projectFigmaLink && (
                      <div className="space-y-2">
                        <h5 className="text-xs font-semibold flex items-center gap-2">
                          <Figma className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                          Figma Design Link
                        </h5>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewFigma(projectFigmaLink)}
                            className="flex-1 text-xs"
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Open in Figma
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleCopyFigmaLink(projectFigmaLink)
                            }
                            className="text-xs"
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy Link
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      
      {/* Regenerate Modal */}
      <RegenerateModal
        isOpen={regenerateModalOpen}
        onClose={() => setRegenerateModalOpen(false)}
        onConfirmRegenerate={handleConfirmRegenerate}
        mapping={selectedMapping}
        projectName={projectName}
      />
    </div>
  );
}

function ComponentDesignContent({
  projectId,
  projectName,
  phaseNumber,
}: {
  projectId: string;
  projectName: string;
  phaseNumber: number;
}) {
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const { toast } = useToast();

  // Fetch design assets
  const { data: assets = [], isLoading } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/design-assets`,
    ],
  });

  // Use custom hook for caching with localStorage persistence
  const activeAsset = useDesignAssetCache(
    projectId,
    phaseNumber,
    "component-design",
    assets
  );

  // Decode content from data URL
  const getDecodedContent = (asset: any) => {
    if (!asset?.fileUrl) return "";
    try {
      const base64Content = asset.fileUrl.replace(
        "data:text/markdown;base64,",
        ""
      );
      return atob(base64Content);
    } catch (error) {
      console.error("Error decoding content:", error);
      return "";
    }
  };

  const content = activeAsset ? getDecodedContent(activeAsset) : "";
  const summary = content
    ? content.substring(0, 200) + (content.length > 200 ? "..." : "")
    : "No component design generated yet. Click 'Generate Design' to create one.";

  const handlePreview = () => {
    if (!activeAsset) {
      toast({
        title: "No Design Available",
        description: "Please generate a Component Design first.",
        variant: "destructive",
      });
      return;
    }
    setPreviewDialogOpen(true);
  };

  const handleDownload = () => {
    if (!activeAsset) {
      toast({
        title: "No Design Available",
        description: "Please generate a Component Design first.",
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([content], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `component_design_${projectName.replace(/\s+/g, "_")}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <Card className="hover-elevate" data-testid="card-component-design">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Container className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium">Component Design</h4>
                  <p className="text-sm text-muted-foreground">
                    {activeAsset ? "AI Generated" : "Not Generated"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePreview}
                  data-testid="button-preview-component-design"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  data-testid="button-download-component-design"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2 ml-8">{summary}</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Component Design Preview</DialogTitle>
            <DialogDescription>
              Component architecture for {projectName}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 h-full">
            <div className="p-6">
              {content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/20 p-4 rounded-lg border">
                    {content}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center p-8 bg-muted/20 rounded-lg border h-full">
                  <div className="text-center space-y-2">
                    <Container className="h-16 w-16 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">No Component Design</p>
                    <p className="text-xs text-muted-foreground">
                      Generate one using the Design Phase button
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
