import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch, useRoute } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Code2,
  Building2,
  FolderOpen,
  FileCode,
  Settings2,
  CheckCircle2,
  Loader2,
  Database,
  Globe,
  Server,
  Wifi,
  WifiOff,
  X,
  Upload,
  Eye,
  Copy,
  ExternalLink,
  Activity,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import ProgressTrackingPanel from "@/components/ProgressTrackingPanel";
import { getApiUrl } from "@/lib/api-config";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";

// Types
interface Organization {
  id: string;
  name: string;
  projectCount: number;
}

interface Project {
  id: string;
  name: string;
  description: string;
  organization: string;
  organizationUrl?: string;
  artifactOrgId?: string;
  workItemCount?: number;
  integrationType?: "ado" | "jira";
  projectKey?: string;
}

interface WorkItem {
  id: string;
  title: string;
  type: string;
  status: string;
}

interface GeneratedFile {
  path: string;
  content: string;
}

interface TokenInfo {
  tokenQuota: number;
  tokenUsed: number;
  remainingTokens: number;
  tokenCost: number;
  canConsume: boolean;
  lowBalance?: boolean;
  isDepleted?: boolean;
}

// Technology options
const FRONTEND_TECHNOLOGIES = [
  { id: "react", name: "React", icon: "⚛️" },
  { id: "angular", name: "Angular", icon: "🅰️" },
  { id: "vue", name: "Vue.js", icon: "💚" },
];

const BACKEND_TECHNOLOGIES = [
  { id: "nodejs", name: "Node.js", icon: "💚" },
  { id: "python", name: "Python", icon: "🐍" },
  { id: "java", name: "Java", icon: "☕" },
  { id: "dotnet", name: ".NET", icon: "🔷" },
];

const DATABASE_TECHNOLOGIES = [
  { id: "mongodb", name: "MongoDB", type: "NoSQL", icon: "🍃" },
  { id: "postgresql", name: "PostgreSQL", type: "SQL", icon: "🐘" },
  { id: "mysql", name: "MySQL", type: "SQL", icon: "🐬" },
  { id: "cosmosdb", name: "Azure Cosmos DB", type: "NoSQL", icon: "🌌" },
];

const AZURE_LLM_OPTIONS = [
  {
    id: "azure-openai",
    name: "Azure OpenAI (GPT)",
    icon: "🤖",
    description: "Microsoft Azure hosted GPT models",
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    icon: "🧠",
    description: "Anthropic's Claude AI models",
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    icon: "💎",
    description: "Google's Gemini AI models",
  },
];

const BEDROCK_LLM_OPTIONS = [
  {
    id: "bedrock",
    name: "Bedrock (Claude)",
    icon: "🧠",
    description: "Amazon Bedrock hosted Claude models",
  },
];

// Mock data for development when API is down
const MOCK_PROJECTS: Project[] = [
  {
    id: "1",
    name: "NousAugmentedDevX",
    organization: "DevX-Platform",
    description: "Main DevX Platform project with AI capabilities",
    organizationUrl: "https://dev.azure.com/DevX-Platform",
    workItemCount: 45,
  },
  {
    id: "2",
    name: "AI-Assistant",
    organization: "DevX-Platform",
    description: "AI Assistant Component for enhanced development",
    organizationUrl: "https://dev.azure.com/DevX-Platform",
    workItemCount: 23,
  },
  {
    id: "3",
    name: "InsecurityApp",
    organization: "InsurityPOC",
    description: "Security POC Application for testing vulnerabilities",
    organizationUrl: "https://dev.azure.com/InsurityPOC",
    workItemCount: 18,
  },
  {
    id: "4",
    name: "Golden_repo",
    organization: "DevX-Hearst",
    description: "Golden Repository with standardized templates",
    organizationUrl: "https://dev.azure.com/DevX-Hearst",
    workItemCount: 67,
  },
];

const MOCK_WORK_ITEMS: WorkItem[] = [
  {
    id: "wi-1",
    title: "User Authentication System",
    type: "Epic",
    status: "Active",
  },
  {
    id: "wi-2",
    title: "Implement OAuth 2.0 Integration",
    type: "Feature",
    status: "Active",
  },
  {
    id: "wi-3",
    title: "Create Login Component",
    type: "User Story",
    status: "New",
  },
  {
    id: "wi-4",
    title: "Dashboard Analytics Feature",
    type: "Feature",
    status: "Active",
  },
  {
    id: "wi-5",
    title: "Real-time Data Visualization",
    type: "User Story",
    status: "New",
  },
  {
    id: "wi-6",
    title: "API Integration Framework",
    type: "Epic",
    status: "Active",
  },
];

export default function CodeGenPage() {
  const { toast } = useToast();
  const jiraOnly = useJiraOnlyWorkItems();
  const integrationName = jiraOnly ? "Jira" : "Azure DevOps";
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [match, params] = useRoute("/sdlc/:projectId/code-gen");
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();

  // Extract URL parameters for SDLC context
  const urlParams = new URLSearchParams(search);
  const urlOrganization =
    urlParams.get("organization") || urlParams.get("organizationName"); // Support both param names
  const urlProjectId = urlParams.get("projectId") || params?.projectId;
  const urlProjectName = urlParams.get("projectName");
  const urlOrganizationUrl = urlParams.get("organizationUrl");
  const isFromSDLC = !!match; // true if coming from SDLC route

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const isGlobalAllOrganizations =
    globalSelectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;
  const isGlobalSpecificOrganizationSelected =
    !!globalSelectedOrganization && !isGlobalAllOrganizations;

  const selectedOrganization = isGlobalSpecificOrganizationSelected
    ? globalSelectedOrganization?.name || null
    : (isFromSDLC ? urlOrganization : null);

  useEffect(() => {
    if (isGlobalSpecificOrganizationSelected) {
      setSelectedProject((currentProject) => {
        if (!currentProject) return currentProject;
        return currentProject.organization?.toLowerCase() ===
          globalSelectedOrganization.name.toLowerCase()
          ? currentProject
          : null;
      });
    }
  }, [globalSelectedOrganization, isGlobalSpecificOrganizationSelected]);
  const [selectedWorkItems, setSelectedWorkItems] = useState<string[]>([]);
  const [selectedFrontend, setSelectedFrontend] = useState<string>("");
  const [selectedBackend, setSelectedBackend] = useState<string>("");
  const [selectedDatabase, setSelectedDatabase] = useState<string>("");
  const LLM_OPTIONS = jiraOnly ? BEDROCK_LLM_OPTIONS : AZURE_LLM_OPTIONS;
  const [selectedLLM, setSelectedLLM] = useState<string>(jiraOnly ? "bedrock" : "azure-openai");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string>("");
  const [processedStories, setProcessedStories] = useState(0);
  const [totalStories, setTotalStories] = useState(0);
  const [useMockData, setUseMockData] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [isPushingToADO, setIsPushingToADO] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState<string | null>(null);
  const [repositoryName, setRepositoryName] = useState<string>("");
  const [pushBranch, setPushBranch] = useState<string>("main");
  const [pushTargetPath, setPushTargetPath] = useState<string>("");
  const [showRepositoryModal, setShowRepositoryModal] = useState(false);
  const [isValidatingRepoName, setIsValidatingRepoName] = useState(false);
  const [isAutoSelecting, setIsAutoSelecting] = useState(false);

  // Progress tracking state
  const [showProgressPanel, setShowProgressPanel] = useState(false);
  const [currentProgressSessionId, setCurrentProgressSessionId] = useState<
    string | null
  >(null);
  const [progressRepositoryName, setProgressRepositoryName] = useState<
    string | null
  >(null);

  // Tenant token info for code generation
  const { data: tokenInfo } = useQuery<TokenInfo>({
    queryKey: ["/api/tokens/info", "code_gen"],
    queryFn: async () => {
      const res = await fetch(
        getApiUrl("/api/tokens/info?operation=code_gen"),
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error("Failed to fetch token info");
      }
      return res.json();
    },
  });

  // Fetch projects using the same API as Artifacts page
  const {
    data: projects = [],
    isLoading: isLoadingProjects,
    error: projectsError,
  } = useQuery<Project[]>({
    queryKey: ["/api/hub/artifacts/projects"],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes (projects don't change often)
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 1, // Only retry once to avoid spamming failed requests
    enabled: !useMockData, // Only fetch if not using mock data
  });

  // Use mock data if API fails or manually enabled
  const shouldUseMockData = useMockData || !!projectsError;
  const currentProjects = shouldUseMockData ? MOCK_PROJECTS : projects;

  // Create organizations list from projects (same as Artifacts page)
  const organizations = currentProjects
    .reduce((acc, project) => {
      const orgName = project.organization || "Default Organization";
      const orgKey = orgName.toLowerCase();

      if (!acc.find((o) => o.id === orgKey)) {
        acc.push({
          id: orgKey,
          name: orgName,
          projectCount: currentProjects.filter(
            (p) =>
              (p.organization || "Default Organization").toLowerCase() ===
              orgKey,
          ).length,
        });
      }
      return acc;
    }, [] as Organization[])
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter projects by selected organization (exact same logic as Artifacts page)
  const filteredProjects = useMemo(() => {
    let filtered = currentProjects;

    // Apply organization filter (case-insensitive) when one is selected
    if (selectedOrganization) {
      const selectedKey = selectedOrganization.toLowerCase();
      filtered = currentProjects.filter(
        (p) =>
          (p.organization || "Default Organization").toLowerCase() ===
          selectedKey,
      );
    }

    // Debug logging for filtered projects
    if (isFromSDLC) {
      console.log("Filtering projects:", {
        selectedOrganization,
        totalProjects: currentProjects.length,
        allProjectOrgs: [
          ...new Set(
            currentProjects.map(
              (p) => p.organization || "Default Organization",
            ),
          ),
        ],
        filteredCount: filtered.length,
        filtered: filtered.map((p) => ({
          id: p.id,
          name: p.name,
          organization: p.organization,
          organizationUrl: p.organizationUrl,
        })),
      });
    }

    return filtered;
  }, [currentProjects, selectedOrganization, isFromSDLC]);

  // Determine if we have enough project information to fetch work items
  const hasProjectInfo =
    selectedProject ||
    (isFromSDLC && urlProjectName && (urlOrganization || urlOrganizationUrl));

  // Create project object from URL params if needed
  const getProjectForWorkItems = () => {
    if (selectedProject) return selectedProject;

    if (
      isFromSDLC &&
      urlProjectName &&
      (urlOrganization || urlOrganizationUrl)
    ) {
      const isJiraProject = jiraOnly ||
        urlOrganizationUrl?.includes("atlassian.net") ||
        urlOrganization === "Jira";
      return {
        id: urlProjectId || urlProjectName,
        name: urlProjectName,
        organization: urlOrganization,
        organizationUrl: urlOrganizationUrl,
        artifactOrgId: null,
        integrationType: isJiraProject ? "jira" as const : "ado" as const,
      };
    }

    return null;
  };

  // Fetch work items for selected project (same as Artifacts page)
  const { data: workItems = [], isLoading: isLoadingWorkItems } = useQuery<
    WorkItem[]
  >({
    queryKey: hasProjectInfo
      ? [
          `/api/hub/artifacts/${urlProjectName || selectedProject?.name}/work-items`,
          selectedProject?.artifactOrgId || urlOrganization,
          selectedProject?.organizationUrl || urlOrganizationUrl,
        ]
      : [],
    enabled: !!hasProjectInfo && !shouldUseMockData,
    queryFn: async () => {
      const project = getProjectForWorkItems();
      if (!project) return [];

      const params = new URLSearchParams();
      const isJira = project.integrationType === "jira" || project.organization === "Jira";

      if (isJira) {
        if (project.id) params.append("projectId", project.id);
        if (project.organizationUrl) params.append("organizationUrl", project.organizationUrl);
      } else {
        if (project.artifactOrgId) {
          params.append("artifactOrgId", project.artifactOrgId);
        } else if (project.organizationUrl) {
          params.append("organizationUrl", project.organizationUrl);
        }
      }

      const basePath = isJira
        ? `/api/hub/artifacts/jira/${project.name}/work-items`
        : `/api/hub/artifacts/${project.name}/work-items`;
      const url = `${basePath}${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await apiRequest("GET", url);
      const data = await response.json();

      // Filter for relevant work item types (adapt for Jira Task/Sub-task projects)
      const allowedTypes = jiraOnly
        ? ["Epic", "Feature", "User Story", "Task", "Sub-task", "Story", "Bug"]
        : ["Epic", "Feature", "User Story"];
      return (data || []).filter((item: WorkItem) =>
        allowedTypes.includes(item.type),
      );
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  });

  // Use mock work items if API is down or in mock mode
  const currentWorkItems = shouldUseMockData ? MOCK_WORK_ITEMS : workItems;

  // Auto-select project when coming from SDLC and data is loaded
  useEffect(() => {
    if (
      isFromSDLC &&
      (urlProjectId || urlProjectName) &&
      !selectedProject &&
      filteredProjects.length > 0 &&
      !isLoadingProjects
    ) {
      setIsAutoSelecting(true);

      // Simple matching - try by ID first, then by name
      let matchingProject = null;

      if (urlProjectId) {
        matchingProject = filteredProjects.find((p) => p.id === urlProjectId);
      }

      if (!matchingProject && urlProjectName) {
        matchingProject = filteredProjects.find(
          (p) => p.name === urlProjectName,
        );
      }

      if (matchingProject) {
        console.log("Auto-selecting project from SDLC:", matchingProject.name);
        setSelectedProject(matchingProject);
      } else {
        console.warn("Could not find matching project. URL params:", {
          urlProjectId,
          urlProjectName,
        });
        console.warn(
          "Available projects:",
          filteredProjects.map((p) => ({ id: p.id, name: p.name })),
        );
      }

      setIsAutoSelecting(false);
    }
  }, [
    isFromSDLC,
    urlProjectId,
    urlProjectName,
    selectedProject,
    filteredProjects,
    isLoadingProjects,
  ]);

  // Determine if fields should be disabled when coming from SDLC
  const isFieldsDisabled =
    (isFromSDLC && (urlOrganization || urlProjectName)) ||
    isGlobalSpecificOrganizationSelected;

  // Check if all required fields are filled
  const isFormValid = useMemo(() => {
    // When coming from SDLC, use URL params as fallback for validation
    const hasOrganization =
      selectedOrganization || (isFromSDLC && urlOrganization);
    const hasProject = selectedProject || (isFromSDLC && urlProjectName);

    return !!(
      hasOrganization &&
      hasProject &&
      selectedWorkItems.length > 0 &&
      selectedFrontend &&
      selectedBackend &&
      selectedDatabase &&
      selectedLLM
    );
  }, [
    selectedOrganization,
    selectedProject,
    selectedWorkItems,
    selectedFrontend,
    selectedBackend,
    selectedDatabase,
    selectedLLM,
    isFromSDLC,
    urlOrganization,
    urlProjectName,
  ]);

  // Reset downstream selections when upstream changes
  useEffect(() => {
    //setSelectedProject(null);
    setSelectedWorkItems([]);
  }, [selectedOrganization]);

  useEffect(() => {
    setSelectedWorkItems([]);
  }, [selectedProject]);

  const handleWorkItemToggle = (workItemId: string) => {
    setSelectedWorkItems((prev) =>
      prev.includes(workItemId)
        ? prev.filter((id) => id !== workItemId)
        : [...prev, workItemId],
    );
  };

  const handleGenerateCode = async () => {
    if (!isFormValid) return;

    setIsGenerating(true);
    setGenerationProgress("Starting generation...");
    setProcessedStories(0);

    // Get selected work items details
    const selectedWorkItemDetails = currentWorkItems.filter((item) =>
      selectedWorkItems.includes(item.id),
    );

    setTotalStories(selectedWorkItemDetails.length);

    // Reset generated files and immediately show modal
    setGeneratedFiles([]);
    setSelectedFileIndex(0);
    setShowCodeModal(true);

    try {
      // Convert work items to user stories format for our API
      const userStories = selectedWorkItemDetails.map((item) => ({
        title: item.title,
        description: `${item.type}: ${item.title}`,
        acceptanceCriteria: [
          `Implement ${item.title.toLowerCase()}`,
          `Follow ${selectedFrontend} patterns for frontend`,
          `Use ${selectedBackend} for backend implementation`,
          `Integrate with ${selectedDatabase} database`,
        ],
      }));

      // Build tech stack string from selected technologies
      const frontendTech = FRONTEND_TECHNOLOGIES.find(
        (t) => t.id === selectedFrontend,
      );
      const backendTech = BACKEND_TECHNOLOGIES.find(
        (t) => t.id === selectedBackend,
      );
      const databaseTech = DATABASE_TECHNOLOGIES.find(
        (t) => t.id === selectedDatabase,
      );

      const techStack = `${frontendTech?.name} frontend with ${backendTech?.name} backend and ${databaseTech?.name} database`;

      console.log("Generating code with configuration:", {
        organization: selectedOrganization,
        project: selectedProject?.id,
        projectName: selectedProject?.name,
        workItems: selectedWorkItems,
        frontend: selectedFrontend,
        backend: selectedBackend,
        database: selectedDatabase,
        techStack,
        userStories,
      });

      // Use progressive generation with Server-Sent Events
      await generateCodeProgressively(userStories, techStack, selectedLLM);

      setGenerationProgress("Generation completed!");
    } catch (error) {
      console.error("Error generating code:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setGenerationProgress(`Error: ${errorMsg}`);

      // Show error toast instead of alert
      toast({
        title: "Code Generation Failed",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePushToADO = async () => {
    if (!selectedProject || generatedFiles.length === 0 || !repositoryName)
      return;

    if (jiraOnly) {
      setIsPushingToADO(true);
      try {
        const response = await fetch("/api/codegen/push-to-github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            files: generatedFiles.map((f) => ({ path: f.path, content: f.content })),
            repositoryName,
            projectName: selectedProject?.name || repositoryName,
            branch: pushBranch || "main",
            targetPath: pushTargetPath || undefined,
          }),
        });
        const result = await response.json();
        if (result.success) {
          setRepositoryUrl(result.repositoryUrl);
          setShowRepositoryModal(false);
          toast({
            title: "Pushed to GitHub",
            description: `${result.filesCreated}/${result.totalFiles} files pushed to ${result.repositoryUrl}`,
          });
        } else {
          toast({ title: "GitHub Push Failed", description: result.error, variant: "destructive" });
        }
      } catch (err: any) {
        toast({ title: "GitHub Push Failed", description: err.message, variant: "destructive" });
      } finally {
        setIsPushingToADO(false);
      }
      return;
    }

    setIsPushingToADO(true);
    setRepositoryUrl(null); // Reset previous repository URL

    try {
      // Get organization name from the project data
      const organizationName = selectedProject.organizationUrl
        ? selectedProject.organizationUrl.split("/").pop()
        : selectedProject.organization;

      // Show progress panel and set repository name for tracking
      setShowProgressPanel(true);
      setProgressRepositoryName(repositoryName);

      // Start tracked repository creation with Ralph Loop
      const response = await fetch(
        `/api/ralph-loop/start-tracked/${organizationName}/${selectedProject.id}/${repositoryName}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetAppService: `${repositoryName.toLowerCase().replace(/[^a-z0-9]/g, "")}`, // Clean app service name
            maxIterations: 3,
            autoFixEnabled: true,
            generatedFiles: generatedFiles,
          }),
        },
      );

      const data = await response.json();

      if (data.success) {
        // Set the session ID for progress tracking
        setCurrentProgressSessionId(data.sessionId);

        toast({
          title: "🚀 Repository Creation Started!",
          description: (
            <div className="space-y-2">
              <p>
                Your repository creation is now running with AI-powered
                monitoring.
              </p>
              <p className="text-sm text-gray-600">
                Track progress in the side panel.
              </p>
            </div>
          ),
          variant: "default",
        });

        // Also trigger the traditional push to ADO in parallel for immediate feedback
        // organizationName can be undefined here; fall back to selectedProject-derived org in performTraditionalPush call below
        await performTraditionalPush(
          organizationName ??
            (selectedProject?.organizationUrl
              ? selectedProject.organizationUrl.split("/").pop() || selectedProject.organization
              : selectedProject?.organization) ??
            "",
        );
      } else {
        throw new Error(data.error || "Failed to start tracked deployment");
      }
    } catch (error) {
      console.error("Error starting tracked deployment:", error);

      // Fallback to traditional push
      toast({
        title: "⚠️ Falling back to standard deployment",
        description:
          "Progress tracking unavailable, using standard deployment process.",
        variant: "default",
      });

      try {
        await performTraditionalPush(
          (selectedProject?.organizationUrl
            ? selectedProject.organizationUrl.split("/").pop() || selectedProject.organization
            : selectedProject?.organization) ?? "",
        );
      } catch (fallbackError) {
        handlePushError(fallbackError);
      }
    } finally {
      setIsPushingToADO(false);
    }
  };

  // Traditional push method (original logic)
  const performTraditionalPush = async (organizationName: string) => {
    // Prepare the request payload - let the backend handle PAT token lookup
    const payload = {
      files: generatedFiles,
      projectName: selectedProject!.name,
      repositoryName: repositoryName, // Use user-provided name
      organizationUrl:
        selectedProject!.organizationUrl ||
        `https://dev.azure.com/${organizationName}`,
      projectId: selectedProject!.id,
    };

    console.log("Pushing files to ADO:", {
      project: selectedProject!.name,
      repository: repositoryName,
      organization: organizationName,
      files: generatedFiles.map((f) => f.path),
      fileCount: generatedFiles.length,
    });

    // Call the actual backend API
    const response = await apiRequest(
      "POST",
      "/api/codegen/push-to-ado",
      payload,
    );
    const data = await response.json();

    console.log("Push to ADO response:", data);

    // Check for successful response
    if (data && data.success === true && data.repositoryUrl) {
      // Success handling - manually close and reset everything
      setRepositoryUrl(data.repositoryUrl);

      // Close modals
      setShowRepositoryModal(false);
      setShowCodeModal(false);

      // Reset all form state
      setRepositoryName("");
      setGeneratedFiles([]);
      setSelectedFileIndex(0);
      setSelectedWorkItems([]);
      setSelectedFrontend("");
      setSelectedBackend("");
      setSelectedDatabase("");

      // Repository URL is now shown in modal - no duplicate toast needed
      console.log("Repository created and available at:", data.repositoryUrl);

      console.log(
        "Successfully pushed to ADO. Repository URL:",
        data.repositoryUrl,
      );
    } else if (data && data.error) {
      // Backend returned structured error
      throw new Error(data.error + (data.details ? `: ${data.details}` : ""));
    } else {
      throw new Error("Unknown error: Invalid response from server");
    }
  };

  const handlePushError = (error: any) => {
    console.error("Error pushing to ADO:", error);

    let errorMessage = `Failed to push files to ${integrationName}`;
    let errorDetails = "";

    if (error instanceof Error) {
      // Check for specific error types from the backend
      if (
        error.message.includes("Permission denied") ||
        error.message.includes("CreateRepository")
      ) {
        errorMessage = "⚠️ Permission Denied";
        errorDetails = `You need 'Git CreateRepository' permission in this ${integrationName} organization. Please contact your ${integrationName} administrator to grant this permission.`;
      } else if (
        error.message.includes("Access denied") ||
        error.message.includes("403")
      ) {
        errorMessage = "🔒 Access Denied";
        errorDetails = `Insufficient permissions to create repository. Please contact your ${integrationName} administrator.`;
      } else if (
        error.message.includes("Authentication failed") ||
        error.message.includes("401")
      ) {
        errorMessage = "🔑 Authentication Failed";
        errorDetails =
          "Please check your Personal Access Token (PAT) configuration.";
      } else {
        errorMessage = "❌ Push Failed";
        errorDetails = error.message;
      }
    } else {
      errorDetails = "Unknown error occurred";
    }

    // Show error toast
    toast({
      title: errorMessage,
      description: errorDetails,
      variant: "destructive",
    });

    console.log("Push to ADO failed:", errorMessage, errorDetails);
  };

  const handleOpenRepositoryModal = () => {
    setShowRepositoryModal(true);
    // Reset repository name when opening modal
    setRepositoryName("");
  };

  const handleCloseRepositoryModal = () => {
    setShowRepositoryModal(false);
    setRepositoryName("");
  };

  const handleCloseModal = () => {
    setShowCodeModal(false);
    // Only reset these if we're not in a successful push state (keep repository URL if it exists)
    if (!repositoryUrl) {
      setGeneratedFiles([]);
      setSelectedFileIndex(0);
    }
    // Reset generation progress
    setGenerationProgress("");
    setProcessedStories(0);
    setTotalStories(0);
  };

  // Progressive code generation using fetch + SSE (EventSource cannot send Authorization header)
  const generateCodeProgressively = async (
    userStories: any[],
    techStack: string,
    llmProvider: string,
  ) => {
    const queryString = new URLSearchParams({
      userStories: JSON.stringify(userStories),
      techStack,
      llmProvider,
    }).toString();

    const sseUrl = `${getApiUrl("/api/codegen/generate-progressive")}?${queryString}`;
    const optionsWithAuth = await addUserInfoToRequest(sseUrl, { credentials: "include" });
    const res = await fetch(sseUrl, optionsWithAuth);

    if (!res.ok) {
      if (res.status === 403) {
        toast.error("You have no permission");
      }
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any)?.message ?? (errBody as any)?.error ?? res.statusText;
      throw new Error(msg || "Connection failed");
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error("No response body");

    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]" || raw === "") continue;
          try {
            const data = JSON.parse(raw);
            switch (data.type) {
              case "progress":
                setGenerationProgress(data.message);
                setProcessedStories(data.processedCount || 0);
                break;
              case "files":
                setGeneratedFiles((prev) => [...prev, ...data.files]);
                setGenerationProgress(`Generated code for: ${data.storyTitle}`);
                setProcessedStories(data.processedCount || 0);
                break;
              case "complete":
                setGenerationProgress("Generation completed!");
                return;
              case "error":
                throw new Error(data.error);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== raw) throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  const copyToClipboard = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast({
        title: "Code Copied",
        description: "Code copied to clipboard!",
        variant: "default",
      });
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement("textarea");
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand("copy");
        toast({
          title: "Code Copied",
          description: "Code copied to clipboard!",
          variant: "default",
        });
      } catch (fallbackErr) {
        toast({
          title: "Copy Failed",
          description: "Failed to copy to clipboard",
          variant: "destructive",
        });
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Back to SDLC button, only show if coming from SDLC */}
      {isFromSDLC && (
        <div className="mb-4 flex items-center">
          <Button
            variant="outline"
            onClick={() => {
              const backParams = new URLSearchParams();
              const backOrganization = urlOrganization || selectedOrganization;
              const backProjectName = urlProjectName || selectedProject?.name;
              const backProjectId = urlProjectId || selectedProject?.id;

              if (backOrganization) {
                backParams.set("organization", backOrganization);
              }
              if (backProjectId) backParams.set("projectId", backProjectId);
              if (backProjectName) backParams.set("projectName", backProjectName);
              if (urlOrganizationUrl) {
                backParams.set("organizationUrl", urlOrganizationUrl);
              }
              backParams.set("phase", "3");

              const query = backParams.toString();
              setLocation(query ? `/sdlc?${query}` : "/sdlc");
            }}
            className="mr-2"
            data-testid="back-to-sdlc-btn"
          >
            ← Back to SDLC
          </Button>
        </div>
      )}
      <div className="mt-2" />
      <PageHeader
        icon={Code2}
        title="Code Generation"
        subtitle={`Generate code from your ${integrationName} work items with customizable technology stack`}
        color="emerald"
      >
        {/* Progress Panel Toggle and Connection Status */}
        <div className="flex items-center space-x-3">
          {/* Progress Panel Toggle */}
          <Button
            variant={showProgressPanel ? "default" : "outline"}
            size="sm"
            onClick={() => setShowProgressPanel(!showProgressPanel)}
            className="flex items-center space-x-2"
          >
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Progress</span>
          </Button>

          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            {shouldUseMockData ? (
              <>
                <WifiOff className="h-4 w-4 text-orange-500" />
                <span className="text-sm text-orange-600">Using demo data</span>
                {!useMockData && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUseMockData(false)}
                    className="ml-2"
                  >
                    Retry API
                  </Button>
                )}
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-600">
                  Connected to {integrationName}
                </span>
              </>
            )}
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Organization & Project Selection */}
        <Card className="border-l-[3px] border-l-emerald-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Organization & Project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Show error message if API fails */}
            {projectsError && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between">
                  <span>
                    Failed to load projects. {integrationName} connection issues
                    detected.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUseMockData(true)}
                    className="ml-4"
                  >
                    Use Demo Data
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Mock Data Notice */}
            {useMockData && (
              <Alert>
                <Wifi className="h-4 w-4" />
                <AlertDescription>
                  Using demo data for development. You can test the full
                  functionality of the Code Generation page.
                </AlertDescription>
              </Alert>
            )}

            {/* Organization (driven by global header selector) */}
            <div className="space-y-2">
              <Label>Organization</Label>
              <div
                className="flex items-center gap-2 p-2 border rounded bg-muted"
                data-testid="organization-field"
              >
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {selectedOrganization || urlOrganization || "All Organizations"}
                </span>
              </div>
            </div>

            {/* Project Selection */}
            <div className="space-y-2">
              <Label htmlFor="project-select">Select Project *</Label>
              {isFieldsDisabled && (selectedProject || urlProjectName) ? (
                <div
                  className="flex items-center gap-2 p-2 border rounded bg-muted"
                  data-testid="project-field"
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">
                    {selectedProject?.name || urlProjectName}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    From SDLC
                  </Badge>
                </div>
              ) : (isLoadingProjects && !shouldUseMockData) ||
                isAutoSelecting ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select
                  value={selectedProject?.id || ""}
                  onValueChange={(value) => {
                    const project = filteredProjects.find(
                      (p) => p.id === value,
                    );
                    setSelectedProject(project || null);
                  }}
                  disabled={Boolean(
                    isFieldsDisabled ||
                      (!selectedOrganization && !isGlobalAllOrganizations) ||
                      (!!projectsError && !useMockData),
                  )}
                >
                  <SelectTrigger
                    id="project-select"
                    className={isFieldsDisabled ? "opacity-50" : ""}
                  >
                    <SelectValue
                      placeholder={
                        projectsError && !useMockData
                          ? "Error loading projects"
                          : isAutoSelecting
                            ? "Auto-selecting project..."
                            : "Choose a project..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {(selectedOrganization || urlOrganization) &&
              (selectedProject || urlProjectName) && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Organization and project selected successfully.
                    {isFromSDLC && (
                      <span className="block text-xs text-muted-foreground mt-1">
                        Pre-populated from SDLC workflow
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
          </CardContent>
        </Card>

        {/* Work Items Selection */}
        <Card className="border-l-[3px] border-l-emerald-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              Work Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>{jiraOnly ? "Select Work Items *" : "Select Epics/Features/User Stories *"}</Label>
              {isLoadingWorkItems && !shouldUseMockData ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : currentWorkItems.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
                  {currentWorkItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-accent transition-colors",
                        selectedWorkItems.includes(item.id) && "bg-primary/10",
                      )}
                      onClick={() => handleWorkItemToggle(item.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedWorkItems.includes(item.id)}
                        onChange={() => handleWorkItemToggle(item.id)}
                        onClick={e => e.stopPropagation()}
                        className="rounded"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {item.type}
                          </Badge>
                          <span className="text-sm font-medium truncate">
                            {item.title}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : hasProjectInfo ? (
                <Alert>
                  <AlertDescription>
                    No work items found for the selected project.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertDescription>
                    Please select a project to view available work items.
                  </AlertDescription>
                </Alert>
              )}

              {selectedWorkItems.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {selectedWorkItems.length} item(s) selected
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Technology Stack Configuration */}
        <Card className="md:col-span-2 border-l-[3px] border-l-emerald-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Technology Stack Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* LLM Selection */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  🤖 AI Language Model *
                </Label>
                <Select value={selectedLLM} onValueChange={setSelectedLLM}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose AI model..." />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_OPTIONS.map((llm) => (
                      <SelectItem key={llm.id} value={llm.id}>
                        <div className="flex flex-col items-start">
                          <div className="flex items-center gap-2">
                            <span>{llm.icon}</span>
                            <span>{llm.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {llm.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                {/* Frontend Technologies */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Frontend Technology *
                  </Label>
                  <Select
                    value={selectedFrontend}
                    onValueChange={setSelectedFrontend}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose frontend..." />
                    </SelectTrigger>
                    <SelectContent>
                      {FRONTEND_TECHNOLOGIES.map((tech) => (
                        <SelectItem key={tech.id} value={tech.id}>
                          <div className="flex items-center gap-2">
                            <span>{tech.icon}</span>
                            {tech.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Backend Technologies */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Backend Technology *
                  </Label>
                  <Select
                    value={selectedBackend}
                    onValueChange={setSelectedBackend}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose backend..." />
                    </SelectTrigger>
                    <SelectContent>
                      {BACKEND_TECHNOLOGIES.map((tech) => (
                        <SelectItem key={tech.id} value={tech.id}>
                          <div className="flex items-center gap-2">
                            <span>{tech.icon}</span>
                            {tech.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Database Technologies */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Database Technology *
                  </Label>
                  <Select
                    value={selectedDatabase}
                    onValueChange={setSelectedDatabase}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose database..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DATABASE_TECHNOLOGIES.map((tech) => (
                        <SelectItem key={tech.id} value={tech.id}>
                          <div className="flex items-center gap-2">
                            <span>{tech.icon}</span>
                            <div className="flex flex-col items-start">
                              <span>{tech.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {tech.type}
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Configuration Summary */}
              {(selectedLLM ||
                selectedFrontend ||
                selectedBackend ||
                selectedDatabase) && (
                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Selected Configuration:</h4>
                  <div className="grid gap-2 text-sm">
                    {selectedLLM && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">AI Model</Badge>
                        <span>
                          {LLM_OPTIONS.find((t) => t.id === selectedLLM)?.name}
                        </span>
                      </div>
                    )}
                    {selectedFrontend && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Frontend</Badge>
                        <span>
                          {
                            FRONTEND_TECHNOLOGIES.find(
                              (t) => t.id === selectedFrontend,
                            )?.name
                          }
                        </span>
                      </div>
                    )}
                    {selectedBackend && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Backend</Badge>
                        <span>
                          {
                            BACKEND_TECHNOLOGIES.find(
                              (t) => t.id === selectedBackend,
                            )?.name
                          }
                        </span>
                      </div>
                    )}
                    {selectedDatabase && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Database</Badge>
                        <span>
                          {
                            DATABASE_TECHNOLOGIES.find(
                              (t) => t.id === selectedDatabase,
                            )?.name
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Generate Button */}
        <Card className="md:col-span-2 border-l-[3px] border-l-emerald-500">
          <CardContent className="pt-6">
            {tokenInfo && (
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Tokens Remaining:{" "}
                  {tokenInfo.remainingTokens.toLocaleString()} /{" "}
                  {tokenInfo.tokenQuota.toLocaleString()}
                </span>
                {tokenInfo.isDepleted ? (
                  <Badge variant="destructive" className="text-xs">
                    No tokens remaining
                  </Badge>
                ) : tokenInfo.lowBalance ? (
                  <Badge
                    variant="outline"
                    className="text-xs border-amber-500 text-amber-700 bg-amber-50 dark:border-amber-500/70 dark:text-amber-300 dark:bg-amber-500/10"
                  >
                    Low balance
                  </Badge>
                ) : null}
              </div>
            )}
            <Button
              className="w-full h-12 text-lg"
              onClick={handleGenerateCode}
              disabled={
                !isFormValid ||
                isGenerating ||
                (tokenInfo != null && !tokenInfo.canConsume)
              }
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Generating Code...
                </>
              ) : (
                <>
                  <Code2 className="h-5 w-5 mr-2" />
                  {tokenInfo?.tokenCost != null
                    ? `Generate Code (${tokenInfo.tokenCost} tokens)`
                    : "Generate Code"}
                </>
              )}
            </Button>

            {!isFormValid && (
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Please fill in all required fields to generate code
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Generated Code Modal */}
      <Dialog open={showCodeModal} onOpenChange={handleCloseModal}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="h-5 w-5" />
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Code Files
                  {totalStories > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      ({processedStories}/{totalStories} stories)
                    </span>
                  )}
                </>
              ) : (
                `Generated Code Files (${generatedFiles.length})`
              )}
            </DialogTitle>
            <DialogDescription>
              {isGenerating
                ? generationProgress || "Starting generation..."
                : `Review the generated code files and choose to push them to ${integrationName} or discard them.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 flex gap-4 min-h-0">
            {isGenerating ? (
              /* Generation Progress View */
              <div className="flex-1 flex flex-col space-y-2 max-h-[600px]">
                {/* Progress Section - Always Visible */}
                <div className="flex-shrink-0 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                    <div className="text-base font-medium">
                      Generating Your Code
                    </div>
                  </div>

                  <div className="text-center space-y-1">
                    <div className="text-sm text-muted-foreground">
                      {generationProgress || "Preparing to generate files..."}
                    </div>

                    {totalStories > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">
                          Progress: {processedStories}/{totalStories} user
                          stories completed
                        </div>
                        <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden mx-auto">
                          <div
                            className="h-full bg-blue-600 transition-all duration-500 ease-out"
                            style={{
                              width: `${totalStories > 0 ? (processedStories / totalStories) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Files Section - Scrollable */}
                {generatedFiles.length > 0 && (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <div className="text-xs font-medium mb-2 text-center">
                      Files Generated So Far ({generatedFiles.length}):
                    </div>
                    <div className="flex gap-4 h-[400px]">
                      {/* File List During Generation */}
                      <div className="w-64 border-r pr-4">
                        <h4 className="font-medium mb-2 flex items-center gap-2 text-sm">
                          <FolderOpen className="h-4 w-4" />
                          Files
                        </h4>
                        <ScrollArea className="h-[360px]">
                          <div className="space-y-1">
                            {generatedFiles.map((file, index) => (
                              <Button
                                key={index}
                                variant={
                                  selectedFileIndex === index
                                    ? "default"
                                    : "ghost"
                                }
                                className="w-full justify-start h-auto p-2 text-xs"
                                onClick={() => setSelectedFileIndex(index)}
                              >
                                <div className="flex items-start gap-2 text-left">
                                  <FileCode className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-medium text-xs truncate">
                                      {file.path.split("/").pop()}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {file.path}
                                    </div>
                                  </div>
                                </div>
                              </Button>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      {/* File Content During Generation */}
                      <div className="flex-1 flex flex-col min-w-0">
                        {generatedFiles[selectedFileIndex] && (
                          <>
                            <div className="flex items-center justify-between mb-2 flex-shrink-0">
                              <div className="flex items-center gap-2">
                                <FileCode className="h-4 w-4" />
                                <h4 className="font-medium truncate text-sm">
                                  {generatedFiles[selectedFileIndex].path}
                                </h4>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  copyToClipboard(
                                    generatedFiles[selectedFileIndex].content,
                                  )
                                }
                              >
                                <Copy className="h-3 w-3 mr-1" />
                                Copy
                              </Button>
                            </div>
                            <ScrollArea className="flex-1 border rounded-md">
                              <pre className="p-4 text-sm bg-muted/50 whitespace-pre-wrap break-words">
                                {generatedFiles[selectedFileIndex].content}
                              </pre>
                            </ScrollArea>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Generated Files View */
              <>
                {/* File List */}
                <div className="w-80 border-r pr-4">
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Files
                  </h4>
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {generatedFiles.map((file, index) => (
                        <Button
                          key={index}
                          variant={
                            selectedFileIndex === index ? "default" : "ghost"
                          }
                          className="w-full justify-start h-auto p-3"
                          onClick={() => setSelectedFileIndex(index)}
                        >
                          <div className="flex items-start gap-2 text-left">
                            <FileCode className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">
                                {file.path.split("/").pop()}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {file.path}
                              </div>
                            </div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* File Content */}
                <div className="flex-1 flex flex-col min-w-0">
                  {generatedFiles[selectedFileIndex] && (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <FileCode className="h-4 w-4" />
                          <h4 className="font-medium truncate">
                            {generatedFiles[selectedFileIndex].path}
                          </h4>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            copyToClipboard(
                              generatedFiles[selectedFileIndex].content,
                            )
                          }
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy
                        </Button>
                      </div>
                      <ScrollArea className="flex-1 border rounded-md">
                        <pre className="p-4 text-sm bg-muted/50 min-h-[400px] whitespace-pre-wrap break-words">
                          {generatedFiles[selectedFileIndex].content}
                        </pre>
                      </ScrollArea>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Repository URL Section */}
          {repositoryUrl && (
            <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <h4 className="font-medium text-foreground">
                  Successfully Pushed to {integrationName}!
                </h4>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Your repository "{repositoryName}" has been created and all{" "}
                {generatedFiles.length} files have been committed.
              </p>
              <div className="flex items-center gap-2">
                <a
                  href={repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Globe className="h-4 w-4" />
                  Open Repository in {integrationName}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(repositoryUrl);
                    toast({
                      title: "URL Copied",
                      description: "Repository URL copied to clipboard!",
                    });
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy URL
                </Button>
              </div>
              <p className="text-xs text-emerald-500 mt-2">
                Click the link above to view your repository, then clone it
                to start developing!
              </p>
            </div>
          )}

          <DialogFooter className="flex gap-3 pt-4">
            <Button variant="outline" onClick={handleCloseModal}>
              <X className="h-4 w-4 mr-2" />
              {isGenerating ? "Cancel" : "Close"}
            </Button>
            {!isGenerating && generatedFiles.length > 0 && !repositoryUrl && (
              <Button
                onClick={handleOpenRepositoryModal}
                disabled={generatedFiles.length === 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Upload className="h-4 w-4 mr-2" />
                PUSH to {integrationName}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Repository Configuration Modal */}
      <Dialog open={showRepositoryModal} onOpenChange={setShowRepositoryModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Repository Configuration
            </DialogTitle>
            <DialogDescription>
              Enter a unique repository name for your generated code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="repository-name" className="text-sm font-medium">
                Repository Name *
              </Label>
              <Input
                id="repository-name"
                type="text"
                value={repositoryName}
                onChange={(e) => setRepositoryName(e.target.value.replace(/\s+/g, "-"))}
                placeholder="e.g., MyProject-Starter"
              />
            </div>
            {jiraOnly && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="push-branch" className="text-sm font-medium">Branch</Label>
                  <Input
                    id="push-branch"
                    value={pushBranch}
                    onChange={(e) => setPushBranch(e.target.value)}
                    placeholder="main"
                  />
                  <p className="text-xs text-muted-foreground">Target branch in the GitHub repository.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="push-target-path" className="text-sm font-medium">Target Folder (optional)</Label>
                  <Input
                    id="push-target-path"
                    value={pushTargetPath}
                    onChange={(e) => setPushTargetPath(e.target.value)}
                    placeholder="e.g. generated-code/my-feature"
                  />
                  <p className="text-xs text-muted-foreground">Sub-folder inside the repo where files will be placed. Leave empty for repo root.</p>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCloseRepositoryModal}>
              Cancel
            </Button>
            <Button
              onClick={handlePushToADO}
              disabled={!repositoryName || isPushingToADO}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isPushingToADO ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Pushing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Push to {jiraOnly ? "GitHub" : "Azure DevOps"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Real-time Progress Tracking Side Panel */}
      {showProgressPanel && (
        <div className="fixed top-16 right-0 h-[calc(100vh-4rem)] w-96 bg-background border-l border-border shadow-xl z-40 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
              <h3 className="font-semibold text-foreground">
                Current Pipelines
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowProgressPanel(false);
                setCurrentProgressSessionId(null);
                setProgressRepositoryName(null);
              }}
              className="h-8 w-8 p-0 hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ProgressTrackingPanel
              repositoryName={progressRepositoryName || undefined}
              onSessionComplete={(session) => {
                console.log("Progress session completed:", session);
                setTimeout(() => {
                  setShowProgressPanel(false);
                  setCurrentProgressSessionId(null);
                  setProgressRepositoryName(null);
                }, 10000);
              }}
              onError={(error) => {
                console.error("Progress tracking error:", error);
              }}
              className="h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
