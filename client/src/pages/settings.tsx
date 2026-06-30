import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useProjectCountForOrg } from "@/hooks/use-project-counts";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsSkeleton } from "@/components/ui/page-skeletons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderPicker } from "@/components/FolderPicker";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { GLOBAL_ALL_ORGANIZATIONS_ID, useSelectedOrganization } from "@/contexts/selected-organization-context";
import {
  Loader2,
  Check,
  X,
  Plus,
  Trash2,
  AlertCircle,
  FolderGit2,
  Settings as SettingsIcon,
  Building2,
  ShieldCheck,
  Smartphone,
  ScanLine,
  KeyRound,
  Database,
  Activity,
} from "lucide-react";
import { SiJira } from "react-icons/si";
import { VscAzureDevops } from "react-icons/vsc";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GenericModal } from "@/components/ui/generic-modal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMsal } from "@azure/msal-react";
import { Link } from "wouter";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import { AdoSettings } from "@shared/schema";
import { useMe } from "@/hooks/use-me";
import { AI_ENHANCE_LOCATIONS } from "@/config/ai-enhance-locations";
import { AddOrganizationDialog } from "@/components/add-organization-dialog";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";

interface ArtifactsOrganization {
  id: string;
  projectName?: string | null;
  organizationUrl: string;
  patConfigured: boolean;
  createdAt?: string;
  updatedAt?: string;
}

type GoldenRepoProvider = "ado" | "github" | "gitlab";

interface GoldenRepoOrganization {
  id: string;
  name: string;
  organizationUrl: string;
  projectName: string;
  repositoryName?: string;
  apiVersion?: string;
  patConfigured: boolean;
  provider?: GoldenRepoProvider;
  createdAt: string;
  updatedAt: string;
}

interface JiraConnection {
  id: string;
  name: string;
  instanceUrl: string;
  email: string;
  hasToken?: boolean;
  patConfigured?: boolean;
  apiTokenEncrypted?: string;
  isAdminConnection?: number | boolean;
  createdAt: string;
  updatedAt: string;
}

type IntegrationType = "datadog" | "servicenow";

interface SdlcProject {
  id: string;
  name: string;
}

interface TenantIntegration {
  id: string;
  integrationType: IntegrationType;
  projectId: string | null;
  baseUrl: string | null;
  status: string;
  hasApiKey: boolean;
  hasAppKey: boolean;
  createdAt: string;
  updatedAt: string;
}

function isPermissionDeniedError(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.httpStatus === 403 ||
    error?.code === "FORBIDDEN" ||
    error?.code === "PERMISSION_DENIED" ||
    message.includes("permission") ||
    message.includes("forbidden")
  );
}


export default function Settings() {
  const { toast } = useToast();
  const jiraOnlyHosting = useJiraOnlyWorkItems();
  const { data: me } = useMe();
  const { selectedOrganization } = useSelectedOrganization();

  const isTenantAdmin = me?.roles?.some((r) => r.role === "TenantAdmin") ?? false;

  // === AI Enhance mapping local state ===
  const [aiEnhanceRepoId, setAiEnhanceRepoId] = useState("");
  const [aiEnhanceFolderPath, setAiEnhanceFolderPath] = useState("");
  const [aiEnhanceLocationMappings, setAiEnhanceLocationMappings] = useState<
    { locationKey: string; filePath: string }[]
  >(() =>
    AI_ENHANCE_LOCATIONS.map((loc) => ({
      locationKey: loc.key,
      filePath: "",
    }))
  );
  const [aiEnhanceHasSaved, setAiEnhanceHasSaved] = useState(false);
  const [aiEnhanceIsEditing, setAiEnhanceIsEditing] = useState(true);
  const [patTokenExpired, setPatTokenExpired] = useState(false);
  const [activeTab, setActiveTab] = useState("central");

  // === Project-scoped integrations state ===
  const [selectedIntegrationProjectId, setSelectedIntegrationProjectId] = useState<string>("");

  // === MFA State ===
  const [mfaSetupData, setMfaSetupData] = useState<{ qrCode: string; secret: string } | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState("");
  const [mfaEnableCode, setMfaEnableCode] = useState("");
  const [showEnableOtp, setShowEnableOtp] = useState(false);

  // === GitHub Connection State ===
  const [ghToken, setGhToken] = useState("");
  const [ghOwner, setGhOwner] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghSaving, setGhSaving] = useState(false);
  const [ghTesting, setGhTesting] = useState(false);
  const [ghEditing, setGhEditing] = useState(false);
  const { data: ghConfig, refetch: refetchGhConfig } = useQuery<{
    configured: boolean;
    maskedApiKey?: string;
    appKey?: string;
    baseUrl?: string;
    updatedAt?: string;
  }>({
    queryKey: ["/api/integrations/github/config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/integrations/github/config");
      return res.json();
    },
  });
  const ghIsConfigured = ghConfig?.configured === true;

  useEffect(() => {
    if (ghConfig?.configured) {
      setGhOwner(ghConfig.appKey || "");
      setGhRepo(ghConfig.baseUrl || "");
      setGhEditing(false);
    } else {
      setGhEditing(true);
    }
  }, [ghConfig]);

  // Query MFA status to know if secret exists (so we can show Enable vs Setup)
  const { data: mfaStatusData } = useQuery<{ isMfaEnabled: boolean; hasMfaSecret: boolean }>({
    queryKey: ["/api/auth/mfa/status", me?.user?.id],
    enabled: !!me?.user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const url = getApiUrl(`/api/auth/mfa/status?userId=${me?.user?.id}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { isMfaEnabled: false, hasMfaSecret: false };
      return res.json();
    },
  });

  const setupMfaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/mfa/setup", { userId: me?.user?.id });
      return response.json();
    },
    onSuccess: (data) => {
      setMfaSetupData({ qrCode: data.qrCode, secret: data.secret });
    },
    onError: (error: any) => {
      toast({ title: "Failed to setup MFA", description: error.message, variant: "destructive" });
    }
  });

  const verifyMfaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/mfa/verify", { userId: me?.user?.id, token: mfaVerifyCode });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
      setMfaSetupData(null);
      setMfaVerifyCode("");
      toast({ title: "MFA Enabled", description: "Authenticator setup successfully!" });
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (error: any) => {
      toast({ title: "Verification Failed", description: error.message || "Invalid code", variant: "destructive" });
    }
  });

  const enableMfaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/mfa/enable", { userId: me?.user?.id, token: mfaEnableCode });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
      setMfaEnableCode("");
      setShowEnableOtp(false);
      toast({ title: "MFA Re-Enabled", description: "MFA has been re-enabled using your existing authenticator." });
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (error: any) => {
      toast({ title: "Enable Failed", description: error.message || "Invalid code", variant: "destructive" });
    }
  });

  const disableMfaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/mfa/disable", { userId: me?.user?.id });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
      toast({ title: "MFA Disabled", description: "MFA has been successfully disabled." });
      sessionStorage.removeItem("mfa_verified");
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (error: any) => {
      toast({ title: "Failed to disable MFA", description: error.message, variant: "destructive" });
    }
  });

  // Load existing mappings from server
  const { data: aiMappingsData, isLoading: isLoadingMappings } = useQuery<{
    mappings: {
      locationKey: string;
      repositoryId: string;
      folderPath: string;
      filePath: string;
    }[];
  }>({
    queryKey: ["/api/ai-enhance/mappings"],
  });

  // ADO settings (organization + project) used to resolve repository tree, same as Golden Repos preview
  const { data: adoSettingsData } = useQuery<Partial<AdoSettings>>({
    queryKey: ["/api/ado-settings"],
    enabled: !jiraOnlyHosting,
  });

  // Golden repo list for AI Enhance dropdown (unified — works for all providers)
  const { data: adoGoldenReposData, isLoading: isLoadingRepos } = useQuery<{
    repositories: { id: string; name: string; description?: string; provider?: string }[];
    provider?: string;
  }>({
    queryKey: ["/api/golden-repositories"],
  });

  const adoGoldenRepos = adoGoldenReposData?.repositories || [];
  const goldenRepoListProvider = adoGoldenReposData?.provider || "ado";

  // Repository tree for folder/file dropdowns
  const selectedAiEnhanceRepo = adoGoldenRepos.find((r: any) => r.id === aiEnhanceRepoId);
  const aiEnhanceRepoProvider = selectedAiEnhanceRepo?.provider || goldenRepoListProvider || "ado";

  const {
    data: repoTreeData,
    isLoading: isLoadingTree,
    error: repoTreeError,
  } = useQuery<any>({
    queryKey: ["/api/repository-tree", aiEnhanceRepoId, aiEnhanceRepoProvider],
    enabled: !!aiEnhanceRepoId,
    queryFn: async () => {
      if (aiEnhanceRepoProvider === "github") {
        const repo = selectedAiEnhanceRepo as any;
        const urlParts = repo?.url ? new URL(repo.url).pathname.split("/").filter(Boolean) : [];
        const owner = urlParts[0] || "";
        const name = urlParts[1] || repo?.name || "";
        const resp = await fetch(getApiUrl(`/api/github/repository/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree`), { credentials: "include" });
        if (!resp.ok) throw new Error("Failed to fetch GitHub tree");
        return resp.json();
      }

      if (aiEnhanceRepoProvider === "gitlab") {
        const resp = await fetch(getApiUrl(`/api/gitlab/repository/${encodeURIComponent(aiEnhanceRepoId)}/tree`), { credentials: "include" });
        if (!resp.ok) throw new Error("Failed to fetch GitLab tree");
        return resp.json();
      }

      const base = `/api/ado/repository/${aiEnhanceRepoId}/tree`;
      const params = new URLSearchParams();

      // Mirror preview behavior: pass organization + project when available
      if (adoSettingsData?.organizationUrl && adoSettingsData.projectName) {
        // Derive short org name from URL (same logic as server extractOrgName)
        let orgName = adoSettingsData.organizationUrl;
        try {
          if (orgName.includes("dev.azure.com")) {
            orgName = orgName
              .replace(/https?:\/\/dev\.azure\.com\//, "")
              .replace(/\/$/, "")
              .split("/")[0];
          } else if (orgName.includes("visualstudio.com")) {
            const match = orgName.match(/([^\.]+)\.visualstudio\.com/);
            if (match) {
              orgName = match[1];
            }
          }
          orgName = orgName.replace(/\/+$/, "").trim();
        } catch {
          // ignore parse errors, fall back to raw URL
        }

        if (orgName) {
          params.append("organization", orgName);
          params.append("projectName", adoSettingsData.projectName);
        }
      }

      const url = params.toString() ? `${base}?${params.toString()}` : base;

      const response = await fetch(getApiUrl(url), {
        credentials: "include",
      });
      if (!response.ok) {
        // Check for 401 Unauthorized (expired PAT token)
        if (response.status === 401) {
          setPatTokenExpired(true);
          const errorData = await response.json().catch(() => ({}));
          throw {
            message: "PAT Token has expired. Please update.",
            httpStatus: 401,
            code: "UNAUTHORIZED",
            ...errorData,
          };
        }
        throw new Error("Failed to load repository tree");
      }
      // Reset expired flag on success
      setPatTokenExpired(false);
      return response.json();
    },
    retry: false, // Don't retry on 401 errors
  });

  // Derive folder and file options from tree (structure: { tree: FileTreeNode[] })
  // Normalize repository tree data to a flat list of nodes we can reuse
  const rawTreeNodes: any[] = (() => {
    if (Array.isArray(repoTreeData)) {
      return repoTreeData as any[];
    }
    if (Array.isArray(repoTreeData?.tree)) {
      return repoTreeData.tree as any[];
    }
    if (Array.isArray(repoTreeData?.items)) {
      return repoTreeData.items as any[];
    }
    return [];
  })();

  const folderOptions: string[] = (() => {
    const nodes = rawTreeNodes;

    const folders: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "folder" && typeof node.path === "string") {
        folders.push(node.path);
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
    };

    nodes.forEach(walk);

    // Always include root as a selectable folder when we have any tree response
    if (nodes.length > 0 && !folders.includes("/")) {
      folders.unshift("/");
    }

    return Array.from(new Set(folders)).sort();
  })();

  const fileOptions: { path: string; name: string }[] = (() => {
    const nodes = rawTreeNodes;
    const files: { path: string; name: string }[] = [];

    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (
        node.type === "file" &&
        typeof node.path === "string" &&
        node.path.toLowerCase().endsWith(".md") &&
        (!aiEnhanceFolderPath || aiEnhanceFolderPath === "/" || node.path.startsWith(aiEnhanceFolderPath))
      ) {
        files.push({
          path: node.path,
          name: node.path.split("/").pop() || node.path,
        });
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
    };

    nodes.forEach(walk);
    return files.sort((a, b) => a.name.localeCompare(b.name));
  })();

  useEffect(() => {
    if (!aiMappingsData || !aiMappingsData.mappings) return;
    const mappings = aiMappingsData.mappings;
    if (mappings.length > 0) {
      setAiEnhanceRepoId(mappings[0].repositoryId || "");
      setAiEnhanceFolderPath(mappings[0].folderPath || "");
      setAiEnhanceHasSaved(true);
      setAiEnhanceIsEditing(false);
    } else {
      setAiEnhanceHasSaved(false);
      setAiEnhanceIsEditing(true);
    }
    setAiEnhanceLocationMappings((prev) =>
      prev.map((m) => {
        const server = mappings.find((sm) => sm.locationKey === m.locationKey);
        return {
          ...m,
          filePath: server?.filePath ?? m.filePath,
        };
      })
    );
  }, [aiMappingsData]);

  const saveAiEnhanceMappingsMutation = useMutation({
    mutationFn: async () => {
      if (!aiEnhanceRepoId.trim() || !aiEnhanceFolderPath.trim()) {
        throw new Error("Repository and folder are required");
      }
      const body = {
        repositoryId: aiEnhanceRepoId.trim(),
        folderPath: aiEnhanceFolderPath.trim(),
        mappings: aiEnhanceLocationMappings
          .filter((m) => m.filePath.trim().length > 0)
          .map((m) => ({
            locationKey: m.locationKey,
            filePath: m.filePath.trim(),
          })),
      };
      const response = await apiRequest(
        "PUT",
        "/api/ai-enhance/mappings",
        body
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-enhance/mappings"] });
      setAiEnhanceHasSaved(true);
      setAiEnhanceIsEditing(false);
      toast({
        title: "AI Enhance mappings saved",
        description:
          "Guideline files have been linked to AI Enhance locations.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save AI Enhance mappings",
        description:
          error?.message || "Please check your inputs and try again.",
        variant: "destructive",
      });
    },
  });

  // Artifacts Organizations Query
  const { data: artifactOrgsData, error: artifactOrgsError } = useQuery<{
    organizations: ArtifactsOrganization[];
  }>({
    queryKey: ["/api/artifact-organizations"],
    retry: false,
    enabled: !jiraOnlyHosting,
  });

  const artifactsOrgs = artifactOrgsData?.organizations || [];
  const isEncryptionAvailable = !artifactOrgsError;

  // Jira Connections Query
  const { data: jiraConnectionsData } = useQuery<{
    connections: JiraConnection[];
  }>({
    queryKey: ["/api/jira/connections"],
  });

  // SDLC Projects for integration scoping
  const { data: sdlcProjectsRaw } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/sdlc/projects"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/sdlc/projects");
      const json = await res.json();
      // API returns SDLCProject[] directly
      return Array.isArray(json) ? json : (json?.projects ?? []);
    },
  });
  const sdlcProjects = (sdlcProjectsRaw ?? []).map((p: any) => ({ id: p.id, name: p.name }));
  const { data: integrationsData, isLoading: isIntegrationsLoading } = useQuery<{
    integrations: TenantIntegration[];
  }>({
    queryKey: ["/api/integrations", selectedIntegrationProjectId],
    queryFn: async () => {
      const apiUrl = getApiUrl("/api/integrations");
      const headers: Record<string, string> = {};
      if (selectedIntegrationProjectId) headers["x-project-id"] = selectedIntegrationProjectId;
      const res = await fetch(apiUrl, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch integrations");
      return res.json();
    },
    enabled: !!selectedIntegrationProjectId, // only fetch when a project is selected
    staleTime: 0,           // mark as stale immediately so next mount re-fetches
    gcTime: 0,              // don't keep stale data in cache
    refetchOnMount: true,   // always re-fetch when component mounts or project changes
    refetchOnWindowFocus: false,
  });

  const jiraConnections = jiraConnectionsData?.connections || [];

  const configuredIntegrations = integrationsData?.integrations || [];
  const datadogIntegration =
    configuredIntegrations.find((i) => i.integrationType === "datadog") ?? null;
  const serviceNowIntegration =
    configuredIntegrations.find((i) => i.integrationType === "servicenow") ?? null;

  const isGlobalAllOrganizations =
    selectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;

  const [addOrgDialogOpen, setAddOrgDialogOpen] = useState(false);
  const [newOrgData, setNewOrgData] = useState({
    organizationUrl: "",
    patToken: "",
  });
  const [orgUrlError, setOrgUrlError] = useState<string | null>(null);
  const [configurePATDialogOpen, setConfigurePATDialogOpen] = useState(false);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [patTokenInput, setPATTokenInput] = useState("");
  const [deleteConfirmDialogOpen, setDeleteConfirmDialogOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState<string | null>(null);

  // Golden Repo Organizations Query (always enabled — multi-provider)
  const { data: goldenRepoOrgsData } = useQuery<{
    organizations: GoldenRepoOrganization[];
    provider?: GoldenRepoProvider;
  }>({
    queryKey: ["/api/golden-repo-organizations"],
  });

  const goldenRepoOrgs = goldenRepoOrgsData?.organizations || [];

  // Golden Repo state
  const [addGoldenRepoDialogOpen, setAddGoldenRepoDialogOpen] = useState(false);
  const [editGoldenRepoDialogOpen, setEditGoldenRepoDialogOpen] =
    useState(false);
  const [editingGoldenRepoId, setEditingGoldenRepoId] = useState<string | null>(
    null
  );
  const [goldenRepoProvider, setGoldenRepoProvider] = useState<GoldenRepoProvider>(jiraOnlyHosting ? "github" : "ado");
  const [integrationDialogOpen, setIntegrationDialogOpen] = useState(false);
  const [integrationDialogType, setIntegrationDialogType] = useState<IntegrationType>("datadog");
  const [integrationFormData, setIntegrationFormData] = useState({
    datadogApiKey: "",
    datadogAppKey: "",
    datadogBaseUrl: "",
    serviceNowBaseUrl: "",
    serviceNowUsername: "",
    serviceNowPassword: "",
  });
  const [integrationToDelete, setIntegrationToDelete] = useState<TenantIntegration | null>(null);
  const [goldenRepoFormData, setGoldenRepoFormData] = useState({
    name: "",
    organizationUrl: "",
    projectName: "",
    repositoryName: "",
    apiVersion: "7.1",
    patToken: "",
    ownerOrGroup: "",
    accessToken: "",
    baseUrl: "",
    branch: "main",
  });
  const [goldenRepoFooterError, setGoldenRepoFooterError] = useState<string | null>(null);

  const isLoading = false;

  const resetIntegrationForm = () => {
    setIntegrationFormData({
      datadogApiKey: "",
      datadogAppKey: "",
      datadogBaseUrl: "",
      serviceNowBaseUrl: "",
      serviceNowUsername: "",
      serviceNowPassword: "",
    });
  };

  const openIntegrationDialog = (type: IntegrationType) => {
    setIntegrationDialogType(type);
    if (type === "datadog") {
      setIntegrationFormData((prev) => ({
        ...prev,
        datadogApiKey: "",
        datadogAppKey: "",
        datadogBaseUrl: datadogIntegration?.baseUrl ?? "https://api.us5.datadoghq.com",
        serviceNowBaseUrl: "",
        serviceNowUsername: "",
        serviceNowPassword: "",
      }));
    } else if (type === "servicenow" && serviceNowIntegration?.baseUrl) {
      setIntegrationFormData((prev) => ({
        ...prev,
        datadogApiKey: "",
        datadogAppKey: "",
        datadogBaseUrl: "",
        serviceNowBaseUrl: serviceNowIntegration.baseUrl ?? "",
        serviceNowUsername: "",
        serviceNowPassword: "",
      }));
    } else {
      resetIntegrationForm();
    }
    setIntegrationDialogOpen(true);
  };

  const closeIntegrationDialog = (open: boolean) => {
    setIntegrationDialogOpen(open);
    if (!open) {
      resetIntegrationForm();
    }
  };

  const saveIntegrationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedIntegrationProjectId) {
        throw new Error("Please select a project before saving.");
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-project-id": selectedIntegrationProjectId,
      };

      if (integrationDialogType === "datadog") {
        if (!integrationFormData.datadogApiKey.trim() || !integrationFormData.datadogAppKey.trim()) {
          throw new Error("Datadog API key and application key are required.");
        }

        const normalizedDatadogBaseUrl = (
          integrationFormData.datadogBaseUrl.trim() || "https://api.us5.datadoghq.com"
        ).replace(/\/+$/, "");

        const res = await fetch(getApiUrl("/api/integrations/configure"), {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            integrationType: "datadog",
            apiKey: integrationFormData.datadogApiKey.trim(),
            appKey: integrationFormData.datadogAppKey.trim(),
            baseUrl: normalizedDatadogBaseUrl,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || data?.message || "Failed to save Datadog configuration");
        return {
          response: data,
          integration: {
            id: datadogIntegration?.id ?? `datadog-${selectedIntegrationProjectId}`,
            integrationType: "datadog" as const,
            projectId: selectedIntegrationProjectId,
            baseUrl: normalizedDatadogBaseUrl,
            status: "active",
            hasApiKey: true,
            hasAppKey: true,
            createdAt: datadogIntegration?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } satisfies TenantIntegration,
        };
      }

      if (
        !integrationFormData.serviceNowBaseUrl.trim() ||
        !integrationFormData.serviceNowUsername.trim() ||
        !integrationFormData.serviceNowPassword.trim()
      ) {
        throw new Error("ServiceNow URL, username, and password are required.");
      }

      const normalizedBaseUrl = integrationFormData.serviceNowBaseUrl.trim().replace(/\/+$/, "");
      const encodedCredential = btoa(
        `${integrationFormData.serviceNowUsername.trim()}:${integrationFormData.serviceNowPassword}`
      );

      const res = await fetch(getApiUrl("/api/integrations/configure"), {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          integrationType: "servicenow",
          baseUrl: normalizedBaseUrl,
          apiKey: encodedCredential,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to save ServiceNow configuration");
      return {
        response: data,
        integration: {
          id: serviceNowIntegration?.id ?? `servicenow-${selectedIntegrationProjectId}`,
          integrationType: "servicenow" as const,
          projectId: selectedIntegrationProjectId,
          baseUrl: normalizedBaseUrl,
          status: "active",
          hasApiKey: true,
          hasAppKey: false,
          createdAt: serviceNowIntegration?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies TenantIntegration,
      };
    },
    onSuccess: async (result: { response?: { message?: string }; integration: TenantIntegration }) => {
      queryClient.setQueryData<{ integrations: TenantIntegration[] }>(
        ["/api/integrations", selectedIntegrationProjectId],
        (current) => {
          const integrations = current?.integrations ?? [];
          const next = integrations.filter(
            (integration) => integration.integrationType !== result.integration.integrationType
          );
          next.push(result.integration);
          return { integrations: next };
        }
      );

      // Invalidate all integration queries (prefix match covers project-scoped keys)
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      // Also force-refetch the exact keyed query so cache is synced with server
      await queryClient.refetchQueries({ queryKey: ["/api/integrations", selectedIntegrationProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/monitoring/system-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/ticket-metrics"] });
      setIntegrationDialogOpen(false);
      resetIntegrationForm();
      toast({
        title: "Integration saved",
        description: result?.response?.message ?? "Configuration saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save integration",
        description: error?.message || "Please verify the configuration and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteIntegrationMutation = useMutation({
    mutationFn: async (integrationType: IntegrationType) => {
      if (!selectedIntegrationProjectId) throw new Error("No project selected.");
      const url = getApiUrl(`/api/integrations/${integrationType}`);
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-project-id": selectedIntegrationProjectId },
      });
      return res.json();
    },
    onSuccess: async (data: { message?: string }, integrationType: IntegrationType) => {
      queryClient.setQueryData<{ integrations: TenantIntegration[] }>(
        ["/api/integrations", selectedIntegrationProjectId],
        (current) => ({
          integrations: (current?.integrations ?? []).filter(
            (integration) => integration.integrationType !== integrationType
          ),
        })
      );

      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      await queryClient.refetchQueries({ queryKey: ["/api/integrations", selectedIntegrationProjectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/monitoring/system-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/ticket-metrics"] });
      setIntegrationToDelete(null);
      toast({
        title: "Integration deleted",
        description: data?.message ?? "Configuration removed successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete integration",
        description: error?.message || "Unable to remove this integration right now.",
        variant: "destructive",
      });
    },
  });

  const formatArtifactOrgName = (org?: ArtifactsOrganization | null) => {
    if (!org) {
      return "this organization";
    }

    // Derive a short, human-friendly organization name (e.g. "test-o" from https://dev.azure.com/test-o/)
    try {
      const parsedUrl = new URL(org.organizationUrl);
      const path = parsedUrl.pathname.replace(/^\//, "").replace(/\/$/, "");

      if (path) {
        const segments = path.split("/");
        const lastSegment = segments[segments.length - 1];
        if (lastSegment) {
          return lastSegment;
        }
      }

      // Fallback to first part of hostname (e.g. "dev" from dev.azure.com) or the full hostname
      const hostParts = parsedUrl.hostname.split(".");
      return hostParts[0] || parsedUrl.hostname;
    } catch {
      // Fallback: return the last non-empty token after a slash, or the raw string
      const manual = org.organizationUrl.split("/").filter(Boolean);
      return manual[manual.length - 1] || org.organizationUrl;
    }
  };

  const formatArtifactOrgDisplayUrl = (organizationUrl: string) => {
    // Display URL without protocol and trailing slash (e.g. "dev.azure.com/test-o")
    try {
      const parsedUrl = new URL(organizationUrl);
      const path = parsedUrl.pathname.replace(/^\//, "").replace(/\/$/, "");
      return path ? `${parsedUrl.hostname}/${path}` : parsedUrl.hostname;
    } catch {
      return organizationUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  };

  const formatIntegrationTimestamp = (value?: string | null) => {
    if (!value) return "Not configured yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not configured yet";
    return date.toLocaleString();
  };

  const getIntegrationLabel = (integrationType: IntegrationType) =>
    integrationType === "datadog" ? "Datadog" : "ServiceNow";

  const getIntegrationStatusTone = (status?: string | null) => {
    const normalized = status?.toLowerCase();
    if (normalized === "active") {
      return "bg-green-100 text-green-700 hover:bg-green-100 border-none";
    }
    if (normalized === "error") {
      return "bg-red-100 text-red-700 hover:bg-red-100 border-none";
    }
    return "bg-amber-100 text-amber-700 hover:bg-amber-100 border-none";
  };

  const OrganizationProjectCount = ({
    orgId,
    type,
  }: {
    orgId: string;
    type: "ado" | "jira";
  }) => {
    const { data, isLoading } = useProjectCountForOrg(orgId);

    if (isLoading) return <Loader2 className="h-3 w-3 animate-spin inline mr-1" />;
    const count = data?.totalCount ?? 0;
    return (
      <Badge variant="secondary" className="px-2 py-0 h-5 text-[10px] font-medium bg-muted text-muted-foreground border-none">
        {count === 0 ? "0 Projects" : `${count} Projects`}
      </Badge>
    );
  };

  // Normalize organization URL for comparison (remove trailing slashes, lowercase)
  const normalizeOrganizationUrl = (url: string): string => {
    if (!url) return "";
    try {
      const parsedUrl = new URL(url);
      // Normalize: lowercase, remove trailing slash from pathname
      const normalizedPath = parsedUrl.pathname.replace(/\/$/, "");
      return `${parsedUrl.protocol}//${parsedUrl.hostname}${normalizedPath}`.toLowerCase();
    } catch {
      // If URL parsing fails, just normalize the string
      return url.trim().replace(/\/$/, "").toLowerCase();
    }
  };

  // Check if organization URL already exists
  const isOrganizationDuplicate = (organizationUrl: string): boolean => {
    if (!organizationUrl) return false;
    const normalizedNewUrl = normalizeOrganizationUrl(organizationUrl);
    return artifactsOrgs.some((org) => {
      const normalizedExistingUrl = normalizeOrganizationUrl(
        org.organizationUrl
      );
      return normalizedExistingUrl === normalizedNewUrl;
    });
  };

  // Check if organization URL is a golden repo organization
  // Only blocks if the organization already exists in the Golden Repository tab
  const isGoldenRepoOrganization = (organizationUrl: string): boolean => {
    if (!organizationUrl || !goldenRepoOrgs || goldenRepoOrgs.length === 0) {
      return false; // Allow if no golden repo orgs loaded or URL is empty
    }
    const normalizedNewUrl = normalizeOrganizationUrl(organizationUrl);
    return goldenRepoOrgs.some((org) => {
      const normalizedGoldenRepoUrl = normalizeOrganizationUrl(
        org.organizationUrl
      );
      return normalizedGoldenRepoUrl === normalizedNewUrl;
    });
  };

  // Create artifact organization mutation
  const createArtifactOrgMutation = useMutation({
    mutationFn: async (data: {
      organizationUrl: string;
      patToken?: string;
    }) => {
      const response = await apiRequest(
        "POST",
        "/api/artifact-organizations",
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      // Invalidate ADO projects query so SDLC nav refreshes automatically
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
      setNewOrgData({ organizationUrl: "", patToken: "" });
      setOrgUrlError(null);
      setAddOrgDialogOpen(false);
      toast({
        title: "Organization Added",
        description: "Organization has been added successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Organization",
        description: error.message || "Could not add organization",
        variant: "destructive",
      });
    },
  });

  // Artifacts Organization Handlers
  const handleAddOrganization = () => {
    if (!newOrgData.organizationUrl) {
      setOrgUrlError("Organization URL is required");
      toast({
        title: "Validation Error",
        description: "Organization URL is required",
        variant: "destructive",
      });
      return;
    }

    // Check if organization is a golden repo organization
    if (isGoldenRepoOrganization(newOrgData.organizationUrl)) {
      setOrgUrlError(
        "This organization is configured as a Golden Repository organization and cannot be added to Client Settings"
      );
      toast({
        title: "Validation Error",
        description:
          "This organization is already configured as a Golden Repository organization. Please use the Golden Repository tab to manage it.",
        variant: "destructive",
      });
      return;
    }

    // Check for duplicate organization
    if (isOrganizationDuplicate(newOrgData.organizationUrl)) {
      setOrgUrlError("This organization already exists");
      toast({
        title: "Validation Error",
        description: "This organization URL already exists in the database",
        variant: "destructive",
      });
      return;
    }

    setOrgUrlError(null);
    createArtifactOrgMutation.mutate(newOrgData);
  };

  // Delete artifact organization mutation
  const deleteArtifactOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest(
        "DELETE",
        `/api/artifact-organizations/${id}`
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      toast({
        title: "Organization Removed",
        description: "Organization has been removed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Remove Organization",
        description: error.message || "Could not remove organization",
        variant: "destructive",
      });
    },
  });

  const handleRemoveOrganization = (id: string) => {
    setOrgToDelete(id);
    setDeleteConfirmDialogOpen(true);
  };

  const confirmDeleteOrganization = () => {
    if (orgToDelete) {
      // Check if it's a Jira connection (GUID format for Jira connections usually)
      const isJira = jiraConnections.some(jc => jc.id === orgToDelete);
      if (isJira) {
        deleteJiraConnectionMutation.mutate(orgToDelete);
      } else {
        deleteArtifactOrgMutation.mutate(orgToDelete);
      }
      setDeleteConfirmDialogOpen(false);
      setOrgToDelete(null);
    }
  };

  // Delete Jira connection mutation
  const deleteJiraConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/jira/connections/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      toast({
        title: "Jira Connection Removed",
        description: "Jira connection has been removed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Remove Jira Connection",
        description: error.message || "Could not remove Jira connection",
        variant: "destructive",
      });
    },
  });

  // Toggle the "admin connection" flag on a Jira connection. The flagged
  // connection's stored email/PAT is used for project creation, which Jira
  // gates behind the global "Administer Jira" permission.
  const setJiraAdminConnectionMutation = useMutation({
    mutationFn: async ({ id, isAdmin }: { id: string; isAdmin: boolean }) => {
      const response = await apiRequest(
        "POST",
        `/api/jira/connections/${id}/set-admin`,
        { isAdmin },
      );
      return response.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      if (data?.warning) {
        toast({
          title: variables.isAdmin
            ? "Marked as Admin Connection (with warning)"
            : "Admin Flag Cleared",
          description: data.warning,
        });
      } else {
        toast({
          title: variables.isAdmin
            ? "Marked as Admin Connection"
            : "Admin Flag Cleared",
          description: variables.isAdmin
            ? "Project creation will use this connection's token."
            : "This connection will no longer be used for project creation.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Admin Flag",
        description: error.message || "Could not update admin flag",
        variant: "destructive",
      });
    },
  });

  const handleConfigurePAT = (orgId: string) => {
    setEditingOrgId(orgId);
    setPATTokenInput("");
    setConfigurePATDialogOpen(true);
  };

  // Update artifact organization mutation (for PAT configuration)
  const updateArtifactOrgMutation = useMutation({
    mutationFn: async ({ id, patToken }: { id: string; patToken: string }) => {
      const response = await apiRequest(
        "PUT",
        `/api/artifact-organizations/${id}`,
        { patToken }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      // Invalidate ADO projects query so SDLC nav refreshes automatically
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
      setConfigurePATDialogOpen(false);
      setEditingOrgId(null);
      setPATTokenInput("");
      toast({
        title: "PAT Token Configured",
        description: "PAT token has been configured successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Configure PAT",
        description: error.message || "Could not configure PAT token",
        variant: "destructive",
      });
    },
  });

  const handleSavePAT = () => {
    if (!editingOrgId || !patTokenInput) {
      toast({
        title: "Validation Error",
        description: "Please enter a PAT token",
        variant: "destructive",
      });
      return;
    }

    updateArtifactOrgMutation.mutate({
      id: editingOrgId,
      patToken: patTokenInput,
    });
  };

  // Golden Repo Organization Mutations
  const resetGoldenRepoForm = () => {
    setGoldenRepoFormData({
      name: "", organizationUrl: "", projectName: "", repositoryName: "",
      apiVersion: "7.1", patToken: "", ownerOrGroup: "", accessToken: "",
      baseUrl: "", branch: "main",
    });
    setGoldenRepoFooterError(null);
  };

  const getGoldenRepoErrorMessage = (error: any, fallback: string) =>
    error?.message || error?.response?.data?.message || error?.response?.data?.error || fallback;

  const createGoldenRepoOrgMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/golden-repo-organizations", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/golden-repo-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/golden-repositories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
      setGoldenRepoFooterError(null);
      setAddGoldenRepoDialogOpen(false);
      resetGoldenRepoForm();
      toast({ title: "Configuration Saved", description: "Golden repo source has been configured successfully" });
    },
    onError: (error: any) => {
      if (isPermissionDeniedError(error)) {
        return;
      }
      setGoldenRepoFooterError(getGoldenRepoErrorMessage(error, "Could not validate and save configuration"));
    },
  });

  const updateGoldenRepoOrgMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest("PUT", `/api/golden-repo-organizations/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/golden-repo-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/golden-repositories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
      setGoldenRepoFooterError(null);
      setEditGoldenRepoDialogOpen(false);
      setEditingGoldenRepoId(null);
      resetGoldenRepoForm();
      toast({ title: "Configuration Updated", description: "Golden repo source has been updated successfully" });
    },
    onError: (error: any) => {
      if (isPermissionDeniedError(error)) {
        return;
      }
      setGoldenRepoFooterError(getGoldenRepoErrorMessage(error, "Could not validate and update configuration"));
    },
  });

  const deleteGoldenRepoOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/golden-repo-organizations/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/golden-repo-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/golden-repositories"] });
      toast({ title: "Configuration Removed", description: "Golden repo source has been removed" });
    },
    onError: (error: any) => {
      if (isPermissionDeniedError(error)) {
        return;
      }
      toast({
        title: "Failed to Remove",
        description: error.message || "Could not remove configuration",
        variant: "destructive",
      });
    },
  });

  // Golden Repo Handlers
  const handleAddGoldenRepo = () => {
    setGoldenRepoFooterError(null);

    if (goldenRepoProvider === "github" || goldenRepoProvider === "gitlab") {
      if (!goldenRepoFormData.ownerOrGroup || !goldenRepoFormData.accessToken) {
        setGoldenRepoFooterError("Owner/Group and Access Token are required.");
        return;
      }
      createGoldenRepoOrgMutation.mutate({
        provider: goldenRepoProvider,
        name: goldenRepoFormData.name || goldenRepoFormData.ownerOrGroup,
        ownerOrGroup: goldenRepoFormData.ownerOrGroup,
        accessToken: goldenRepoFormData.accessToken,
        baseUrl: goldenRepoFormData.baseUrl || undefined,
        branch: goldenRepoFormData.branch || "main",
      } as any);
    } else {
      if (!goldenRepoFormData.name || !goldenRepoFormData.organizationUrl || !goldenRepoFormData.projectName) {
        setGoldenRepoFooterError("Please fill in all required fields.");
        return;
      }
      createGoldenRepoOrgMutation.mutate({ ...goldenRepoFormData, provider: "ado" } as any);
    }
  };

  const handleEditGoldenRepo = (org: GoldenRepoOrganization) => {
    setGoldenRepoFooterError(null);
    setEditingGoldenRepoId(org.id);
    const prov = org.provider || "ado";
    setGoldenRepoProvider(prov);
    if (prov === "github" || prov === "gitlab") {
      setGoldenRepoFormData({
        name: org.name,
        organizationUrl: org.organizationUrl || "",
        projectName: org.projectName || "",
        repositoryName: "",
        apiVersion: "",
        patToken: "",
        ownerOrGroup: org.projectName || org.name,
        accessToken: "",
        baseUrl: org.organizationUrl || "",
        branch: "main",
      });
    } else {
      setGoldenRepoFormData({
        name: org.name,
        organizationUrl: org.organizationUrl,
        projectName: org.projectName,
        repositoryName: org.repositoryName || "",
        apiVersion: org.apiVersion || "7.1",
        patToken: "",
        ownerOrGroup: "",
        accessToken: "",
        baseUrl: "",
        branch: "main",
      });
    }
    setEditGoldenRepoDialogOpen(true);
  };

  const handleUpdateGoldenRepo = () => {
    if (!editingGoldenRepoId) return;
    setGoldenRepoFooterError(null);

    if (goldenRepoProvider === "github" || goldenRepoProvider === "gitlab") {
      const updateData: any = {
        provider: goldenRepoProvider,
        name: goldenRepoFormData.name || goldenRepoFormData.ownerOrGroup,
        ownerOrGroup: goldenRepoFormData.ownerOrGroup,
      };
      if (goldenRepoFormData.accessToken) updateData.accessToken = goldenRepoFormData.accessToken;
      if (goldenRepoFormData.baseUrl) updateData.baseUrl = goldenRepoFormData.baseUrl;
      updateGoldenRepoOrgMutation.mutate({ id: editingGoldenRepoId, data: updateData });
    } else {
      const updateData: any = {
        provider: "ado",
        name: goldenRepoFormData.name,
        organizationUrl: goldenRepoFormData.organizationUrl,
        projectName: goldenRepoFormData.projectName,
        repositoryName: goldenRepoFormData.repositoryName,
        apiVersion: goldenRepoFormData.apiVersion,
      };
      if (goldenRepoFormData.patToken) updateData.patToken = goldenRepoFormData.patToken;
      updateGoldenRepoOrgMutation.mutate({ id: editingGoldenRepoId, data: updateData });
    }
  };

  const handleDeleteGoldenRepo = (id: string) => {
    if (confirm("Are you sure you want to delete this configuration?")) {
      deleteGoldenRepoOrgMutation.mutate(id);
    }
  };

  if (isLoading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="flex-1 space-y-6 p-6">
        <PageHeader
          icon={SettingsIcon}
          title="Settings"
          subtitle="Manage your application settings and integrations"
          color="slate"
          data-testid="heading-settings"
        >

        </PageHeader>

        <Tabs
          defaultValue="central"
          className="w-full"
          onValueChange={setActiveTab}
          data-testid="settings-tabs"
        >
          <TabsList className="grid w-full grid-cols-3" data-testid="tabs-list">
            <TabsTrigger value="central" data-testid="tab-central">
              Client Settings
            </TabsTrigger>
            <TabsTrigger value="golden-repo" data-testid="tab-golden-repo">
              Golden Repository
            </TabsTrigger>
            <TabsTrigger value="security" data-testid="tab-security">
              Security
            </TabsTrigger>
          </TabsList>

          {/* Third-Party Integrations tab removed — all tool integrations (repo, CI/CD, monitoring, ticketing)
              are now configured per-project in the Create/Edit Project wizard. */}
          {false && <TabsContent value="integrations" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Third-Party Integrations</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect GitHub (tenant-wide), project-scoped repository and CI/CD tools, Datadog, and
                  ServiceNow for your SDLC workflows.
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-4">
                <Label className="text-xs font-semibold">SDLC project (Datadog &amp; ServiceNow)</Label>
                <Select
                  value={selectedIntegrationProjectId}
                  onValueChange={setSelectedIntegrationProjectId}
                >
                  <SelectTrigger className="w-full max-w-md" id="integration-project-select">
                    <SelectValue placeholder="Choose a project to configure..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sdlcProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                    {sdlcProjects.length === 0 && (
                      <SelectItem value="__none__" disabled>No SDLC projects found</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {!selectedIntegrationProjectId && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Select a project to configure repository, CI/CD, Datadog, and ServiceNow.
                  </p>
                )}
              </div>
            </div>

            {selectedIntegrationProjectId ? (
              <ProjectToolIntegrationsPanel projectId={selectedIntegrationProjectId} />
            ) : null}

            <Card className="border-l-[3px] border-l-emerald-500">
              <CardHeader className="flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle>GitHub Connection</CardTitle>
                    <Badge variant="secondary" className="font-normal">
                      Tenant-wide
                    </Badge>
                    {ghIsConfigured && !ghEditing && (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-500 gap-1">
                        <Check className="h-3 w-3" />
                        Connected
                      </Badge>
                    )}
                  </div>
                  <CardDescription>
                    Tenant-wide GitHub credentials used by Specs push, golden repos, and other Git operations.
                  </CardDescription>
                </div>
                {ghIsConfigured && !ghEditing && (
                  <Button variant="outline" size="sm" onClick={() => { setGhEditing(true); setGhToken(""); }}>
                    Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {ghIsConfigured && !ghEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                      <span className="text-muted-foreground">Token</span>
                      <span className="font-mono">{ghConfig?.maskedApiKey}</span>
                      <span className="text-muted-foreground">Owner / Org</span>
                      <span className="font-medium">{ghConfig?.appKey}</span>
                      <span className="text-muted-foreground">Default Repo</span>
                      <span className="font-medium">{ghConfig?.baseUrl || <span className="text-muted-foreground italic">Not set</span>}</span>
                      {ghConfig?.updatedAt && (
                        <>
                          <span className="text-muted-foreground">Last updated</span>
                          <span className="text-muted-foreground">{new Date(ghConfig.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const tokenValue = ghToken;
                      const ownerValue = ghOwner;
                      const repoValue = ghRepo;
                      if ((!tokenValue && !ghIsConfigured) || !ownerValue) {
                        toast({ title: "Validation", description: "Token and Owner/Org are required.", variant: "destructive" });
                        return;
                      }
                      setGhSaving(true);
                      try {
                        const res = await apiRequest("POST", "/api/integrations/configure", {
                          integrationType: "github",
                          apiKey: tokenValue || "__KEEP_EXISTING__",
                          appKey: ownerValue,
                          baseUrl: repoValue || null,
                        });
                        if (res.ok) {
                          toast({ title: "Success", description: "GitHub connection saved!" });
                          queryClient.invalidateQueries({ queryKey: ["/api/integrations/github/config"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/github/repositories"] });
                          setGhToken("");
                          await refetchGhConfig();
                        } else {
                          throw new Error(await res.text());
                        }
                      } catch (err: any) {
                        toast({ title: "Error", description: err.message, variant: "destructive" });
                      } finally {
                        setGhSaving(false);
                      }
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="githubToken">Personal Access Token {!ghIsConfigured && <span className="text-destructive">*</span>}</Label>
                      <Input
                        id="githubToken"
                        type="password"
                        required={!ghIsConfigured}
                        placeholder={ghIsConfigured ? "Leave blank to keep existing token" : "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                        value={ghToken}
                        onChange={(e) => setGhToken(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {ghIsConfigured
                          ? "Leave blank to keep the existing token, or enter a new one to replace it."
                          : <>Needs <strong>repo</strong> scope (read &amp; write). Fine-grained tokens also work.</>
                        }
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="githubOwner">Owner / Organisation <span className="text-destructive">*</span></Label>
                      <Input
                        id="githubOwner"
                        required
                        placeholder="e.g. DevXGitRepo"
                        value={ghOwner}
                        onChange={(e) => setGhOwner(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">GitHub username or organisation that owns the repositories.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="githubRepo">Default Repository (optional)</Label>
                      <Input
                        id="githubRepo"
                        placeholder="e.g. devx-artifacts"
                        value={ghRepo}
                        onChange={(e) => setGhRepo(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Used as the default target repository for pushes when no project-specific repo is configured.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button type="submit" disabled={ghSaving}>
                        {ghSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {ghIsConfigured ? "Update Connection" : "Save GitHub Connection"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={ghTesting}
                        onClick={async () => {
                          const tokenForTest = ghToken || "";
                          const ownerForTest = ghOwner;
                          if ((!tokenForTest && !ghIsConfigured) || !ownerForTest) {
                            toast({ title: "Validation", description: "Enter Token and Owner first to test.", variant: "destructive" });
                            return;
                          }
                          setGhTesting(true);
                          try {
                            const payload: Record<string, string> = { owner: ownerForTest };
                            if (tokenForTest) payload.token = tokenForTest;
                            const res = await apiRequest("POST", "/api/integrations/test-github", payload);
                            const data = await res.json();
                            if (res.ok && data.success) {
                              toast({ title: "Connection Successful", description: `Found ${data.repoCount} repositories for ${ownerForTest}.` });
                            } else {
                              toast({ title: "Connection Failed", description: data.error || "Could not connect to GitHub.", variant: "destructive" });
                            }
                          } catch (err: any) {
                            toast({ title: "Connection Failed", description: err.message, variant: "destructive" });
                          } finally {
                            setGhTesting(false);
                          }
                        }}
                      >
                        {ghTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Test Connection
                      </Button>
                      {ghIsConfigured && (
                        <Button type="button" variant="ghost" onClick={() => { setGhEditing(false); setGhToken(""); setGhOwner(ghConfig?.appKey || ""); setGhRepo(ghConfig?.baseUrl || ""); }}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            <Card className="border-l-[3px] border-l-slate-500">
              <CardContent className="grid gap-6 xl:grid-cols-2 pt-6">
                <Card className="border-l-[3px] border-l-orange-500">
                  <CardHeader className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Activity className="h-5 w-5 text-orange-500" />
                          Datadog
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Monitoring configuration — system state, uptime, and recent events.
                        </CardDescription>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          isIntegrationsLoading
                            ? "bg-slate-100 text-slate-400 hover:bg-slate-100 border-none"
                            : datadogIntegration
                            ? "bg-green-100 text-green-700 hover:bg-green-100 border-none"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-100 border-none"
                        }
                      >
                        {isIntegrationsLoading ? (
                          <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Checking...</span>
                        ) : datadogIntegration ? "Configured" : "Not configured"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className={getIntegrationStatusTone(datadogIntegration?.status)}>
                        Status: {isIntegrationsLoading ? "loading..." : (datadogIntegration?.status ?? "not configured")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!selectedIntegrationProjectId ? (
                      <p className="text-sm text-muted-foreground">Select a project above to see or configure Datadog.</p>
                    ) : isIntegrationsLoading ? (
                      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading Datadog configuration...
                      </div>
                    ) : datadogIntegration ? (
                      <>
                        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">API key</span>
                            <span className="font-medium">Configured</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Application key</span>
                            <span className="font-medium">{datadogIntegration.hasAppKey ? "Configured" : "Missing"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Last updated</span>
                            <span className="font-medium text-right">{formatIntegrationTimestamp(datadogIntegration.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => openIntegrationDialog("datadog")}>
                            Reconfigure
                          </Button>
                          <Button
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setIntegrationToDelete(datadogIntegration)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Configuration
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-4 rounded-lg border border-dashed border-border p-5">
                        <p className="text-sm text-muted-foreground">
                          No Datadog configuration for this project yet.
                        </p>
                        <Button onClick={() => openIntegrationDialog("datadog")}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Datadog Configuration
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-l-[3px] border-l-purple-500">
                  <CardHeader className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Database className="h-5 w-5 text-purple-500" />
                          ServiceNow
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Operations configuration — incidents, MTTR, and active high-priority tickets.
                        </CardDescription>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          isIntegrationsLoading
                            ? "bg-slate-100 text-slate-400 hover:bg-slate-100 border-none"
                            : serviceNowIntegration
                            ? "bg-green-100 text-green-700 hover:bg-green-100 border-none"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-100 border-none"
                        }
                      >
                        {isIntegrationsLoading ? (
                          <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Checking...</span>
                        ) : serviceNowIntegration ? "Configured" : "Not configured"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className={getIntegrationStatusTone(serviceNowIntegration?.status)}>
                        Status: {isIntegrationsLoading ? "loading..." : (serviceNowIntegration?.status ?? "not configured")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!selectedIntegrationProjectId ? (
                      <p className="text-sm text-muted-foreground">Select a project above to see or configure ServiceNow.</p>
                    ) : isIntegrationsLoading ? (
                      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading ServiceNow configuration...
                      </div>
                    ) : serviceNowIntegration ? (
                      <>
                        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Instance URL</span>
                            <span className="max-w-[65%] truncate font-medium text-right">{serviceNowIntegration.baseUrl ?? "Not provided"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Credentials</span>
                            <span className="font-medium">{serviceNowIntegration.hasApiKey ? "Configured" : "Missing"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Last updated</span>
                            <span className="font-medium text-right">{formatIntegrationTimestamp(serviceNowIntegration.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => openIntegrationDialog("servicenow")}>
                            Reconfigure
                          </Button>
                          <Button
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setIntegrationToDelete(serviceNowIntegration)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Configuration
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-4 rounded-lg border border-dashed border-border p-5">
                        <p className="text-sm text-muted-foreground">
                          No ServiceNow configuration for this project yet.
                        </p>
                        <Button onClick={() => openIntegrationDialog("servicenow")}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add ServiceNow Configuration
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>}

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            <Card className="border-l-[3px] border-l-slate-500">
              <CardHeader>
                <CardTitle>Multi-Factor Authentication (MFA)</CardTitle>
                <CardDescription>Add an extra layer of security to your DevX account using an Authenticator app (like Microsoft Authenticator).</CardDescription>
              </CardHeader>
              <CardContent>
                {me?.user?.isMfaEnabled ? (
                  /* ===== STATE 1: MFA is ENABLED ===== */
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 text-green-600 dark:text-green-400">
                      <Check className="h-6 w-6" />
                      <span className="font-medium text-lg">MFA is successfully enabled on your account.</span>
                    </div>
                    <Button 
                      variant="destructive" 
                      onClick={() => disableMfaMutation.mutate()}
                      disabled={disableMfaMutation.isPending}
                      className="w-fit"
                    >
                      {disableMfaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Disable MFA
                    </Button>
                  </div>
                ) : mfaStatusData?.hasMfaSecret ? (
                  /* ===== STATE 2: MFA DISABLED but secret exists — re-enable with OTP only ===== */
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-6 w-6" />
                      <span className="font-medium text-lg">MFA is currently disabled on your account.</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-5 rounded-xl border border-border shadow-sm max-w-xl">
                      <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                        Your authenticator app is still configured. You can re-enable MFA by entering the 6-digit code from your Authenticator app (no need to scan a QR code again).
                      </p>
                      {!showEnableOtp ? (
                        <div className="flex gap-3">
                          <Button onClick={() => setShowEnableOtp(true)} className="gap-2">
                            <ShieldCheck className="h-4 w-4" />
                            Enable MFA
                          </Button>
                          <Button variant="outline" onClick={() => setupMfaMutation.mutate()} disabled={setupMfaMutation.isPending}>
                            {setupMfaMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Set up new MFA
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <Label>Enter 6-digit code from your Authenticator app</Label>
                          <div className="flex gap-2">
                            <Input 
                              value={mfaEnableCode} 
                              onChange={(e) => setMfaEnableCode(e.target.value)} 
                              placeholder="000000" 
                              maxLength={6}
                              className="max-w-[180px] text-center text-lg tracking-widest"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && mfaEnableCode.length === 6 && !enableMfaMutation.isPending) {
                                  enableMfaMutation.mutate();
                                }
                              }}
                            />
                            <Button onClick={() => enableMfaMutation.mutate()} disabled={mfaEnableCode.length !== 6 || enableMfaMutation.isPending}>
                              {enableMfaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                              Verify & Enable
                            </Button>
                            <Button variant="ghost" onClick={() => { setShowEnableOtp(false); setMfaEnableCode(""); }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Show setup guide + QR code if user clicked "Set up new MFA" */}
                    {mfaSetupData && (
                      <div className="space-y-4 max-w-2xl">
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-border shadow-sm">
                          <h4 className="font-semibold text-lg text-foreground mb-6 flex items-center gap-2 border-b pb-4">
                            <ShieldCheck className="h-6 w-6 text-primary" /> 
                            Quick Setup Guide
                          </h4>
                          
                          <div className="space-y-6">
                            <div className="flex gap-4">
                              <div className="flex-shrink-0 mt-1">
                                <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                  <Smartphone className="h-5 w-5" />
                                </div>
                              </div>
                              <div>
                                <h5 className="font-medium text-foreground text-base">Step 1: Get the App</h5>
                                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
                                  Download and install <strong>Microsoft Authenticator</strong> (or Google Authenticator) on your mobile device from your phone's app store.
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-4">
                              <div className="flex-shrink-0 mt-1">
                                <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                  <ScanLine className="h-5 w-5" />
                                </div>
                              </div>
                              <div>
                                <h5 className="font-medium text-foreground text-base">Step 2: Scan the Code</h5>
                                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
                                  In your Authenticator app, tap the '+' icon to add a new account and scan the QR Code below.
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-4">
                              <div className="flex-shrink-0 mt-1">
                                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center">
                                  <KeyRound className="h-5 w-5" />
                                </div>
                              </div>
                              <div>
                                <h5 className="font-medium text-foreground text-base">Step 3: Enter the Code</h5>
                                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
                                  Your app will generate a temporary 6-digit code. Enter that code into the verification box below to finalize your secure setup!
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4 max-w-sm">
                          <div className="bg-muted p-4 rounded-md inline-block bg-white">
                            <img src={mfaSetupData.qrCode} alt="MFA QR Code" className="w-[200px] h-[200px]" />
                          </div>
                          <p className="text-sm text-muted-foreground">Scan this new QR code with your Authenticator app, then enter the 6-digit code below to verify.</p>
                          <div className="space-y-2">
                            <Label>6-Digit Verification Code</Label>
                            <div className="flex gap-2">
                              <Input value={mfaVerifyCode} onChange={(e) => setMfaVerifyCode(e.target.value)} placeholder="000000" maxLength={6} />
                              <Button onClick={() => verifyMfaMutation.mutate()} disabled={mfaVerifyCode.length !== 6 || verifyMfaMutation.isPending}>
                                {verifyMfaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Enable"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* ===== STATE 3: First-time setup — full QR scan flow ===== */
                  <div className="space-y-6">
                    {!mfaSetupData ? (
                      <div className="space-y-4 max-w-2xl">
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-border shadow-sm">
                          <h4 className="font-semibold text-lg text-foreground mb-6 flex items-center gap-2 border-b pb-4">
                            <ShieldCheck className="h-6 w-6 text-primary" /> 
                            Quick Setup Guide
                          </h4>
                          
                          <div className="space-y-6">
                            <div className="flex gap-4">
                              <div className="flex-shrink-0 mt-1">
                                <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                  <Smartphone className="h-5 w-5" />
                                </div>
                              </div>
                              <div>
                                <h5 className="font-medium text-foreground text-base">Step 1: Get the App</h5>
                                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
                                  Download and install <strong>Microsoft Authenticator</strong> (or Google Authenticator) on your mobile device from your phone's app store.
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-4">
                              <div className="flex-shrink-0 mt-1">
                                <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                  <ScanLine className="h-5 w-5" />
                                </div>
                              </div>
                              <div>
                                <h5 className="font-medium text-foreground text-base">Step 2: Scan the Code</h5>
                                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
                                  Click the <strong>"Set up MFA"</strong> button below. In your Authenticator app, tap the '+' icon to add a new account and scan the QR Code that appears.
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-4">
                              <div className="flex-shrink-0 mt-1">
                                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center">
                                  <KeyRound className="h-5 w-5" />
                                </div>
                              </div>
                              <div>
                                <h5 className="font-medium text-foreground text-base">Step 3: Enter the Code</h5>
                                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
                                  Your app will generate a temporary 6-digit code. Enter that code into the verification box below to finalize your secure setup!
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                        <Button onClick={() => setupMfaMutation.mutate()} disabled={setupMfaMutation.isPending}>
                          {setupMfaMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                          Set up MFA
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4 max-w-sm">
                        <div className="bg-muted p-4 rounded-md inline-block bg-white">
                          <img src={mfaSetupData.qrCode} alt="MFA QR Code" className="w-[200px] h-[200px]" />
                        </div>
                        <p className="text-sm text-muted-foreground">Scan this QR code with your Authenticator app, then enter the 6-digit code below to verify.</p>
                        <div className="space-y-2">
                          <Label>6-Digit Verification Code</Label>
                          <div className="flex gap-2">
                            <Input value={mfaVerifyCode} onChange={(e) => setMfaVerifyCode(e.target.value)} placeholder="000000" maxLength={6} />
                            <Button onClick={() => verifyMfaMutation.mutate()} disabled={mfaVerifyCode.length !== 6 || verifyMfaMutation.isPending}>
                              {verifyMfaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Enable"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Golden Repository Settings Tab */}
          <TabsContent value="golden-repo" className="space-y-6">
            {patTokenExpired && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Token Expired</AlertTitle>
                <AlertDescription>
                  Token has expired please update it.
                </AlertDescription>
              </Alert>
            )}
            <Card className="border-l-[3px] border-l-slate-500" data-testid="card-golden-repo-settings">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle data-testid="heading-golden-repo-settings">
                      Golden Repository Source
                    </CardTitle>
                    <CardDescription>
                      Configure the Git provider and source for golden repository templates
                    </CardDescription>
                  </div>
                  {isTenantAdmin && (
                    <Button
                      onClick={() => {
                        resetGoldenRepoForm();
                        setGoldenRepoProvider(jiraOnlyHosting ? "github" : "ado");
                        setAddGoldenRepoDialogOpen(true);
                      }}
                      data-testid="button-add-golden-repo-org"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Configure Source
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {goldenRepoOrgs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p data-testid="text-no-organizations">
                      No golden repository source configured
                    </p>
                    <p className="text-sm mt-2">
                      Configure a Git provider (GitHub, GitLab, or Azure DevOps) to get started
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {goldenRepoOrgs.map((org) => {
                      const prov = org.provider || "ado";
                      const provLabel = prov === "github" ? "GitHub" : prov === "gitlab" ? "GitLab" : "Azure DevOps";
                      return (
                        <Card
                          key={org.id}
                          className="hover-elevate border-l-[3px] border-l-slate-500"
                          data-testid={`org-card-${org.id}`}
                        >
                          <CardContent className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-3">
                                  <h3
                                    className="font-semibold text-lg"
                                    data-testid={`org-name-${org.id}`}
                                  >
                                    {org.name}
                                  </h3>
                                  <Badge variant="outline">{provLabel}</Badge>
                                  {org.patConfigured ? (
                                    <Badge variant="default" data-testid={`org-pat-status-${org.id}`}>
                                      Token Configured
                                    </Badge>
                                  ) : (
                                    <Badge variant="destructive" data-testid={`org-pat-status-${org.id}`}>
                                      Token Missing
                                    </Badge>
                                  )}
                                </div>
                                <div className="space-y-1 text-sm text-muted-foreground">
                                  {prov === "ado" ? (
                                    <>
                                      <div><span className="font-medium">Organization:</span> {org.organizationUrl}</div>
                                      <div><span className="font-medium">Project:</span> {org.projectName}</div>
                                      {org.apiVersion && <div><span className="font-medium">API Version:</span> {org.apiVersion}</div>}
                                    </>
                                  ) : (
                                    <>
                                      <div><span className="font-medium">Owner / Group:</span> {org.projectName || org.name}</div>
                                      {org.organizationUrl && <div><span className="font-medium">URL:</span> {org.organizationUrl}</div>}
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleEditGoldenRepo(org)} data-testid={`button-edit-org-${org.id}`}>
                                  Edit
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDeleteGoldenRepo(org.id)} data-testid={`button-delete-org-${org.id}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Enhance → Golden Repository Guideline Mappings */}
            <Card className="border-l-[3px] border-l-slate-500">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>AI Enhance Configuration</CardTitle>
                    <CardDescription>
                      Map each AI Enhance location to a guideline file in your
                      golden repository.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {aiEnhanceHasSaved && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAiEnhanceIsEditing(true)}
                        disabled={aiEnhanceIsEditing}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => saveAiEnhanceMappingsMutation.mutate()}
                      disabled={
                        !aiEnhanceIsEditing ||
                        saveAiEnhanceMappingsMutation.isPending ||
                        !aiEnhanceRepoId ||
                        !aiEnhanceFolderPath
                      }
                    >
                      {saveAiEnhanceMappingsMutation.isPending ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save AI Enhance Mappings"
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Basic repo/folder config */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Repository</Label>
                    {isLoadingRepos ? (
                      <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Loading repositories...
                        </span>
                      </div>
                    ) : (
                      <Select
                        value={aiEnhanceRepoId}
                        onValueChange={(value) => {
                          setAiEnhanceRepoId(value);
                          // Reset folder and file mappings when repo changes
                          setAiEnhanceFolderPath("");
                          setAiEnhanceLocationMappings((prev) =>
                            prev.map((m) => ({
                              ...m,
                              filePath: "",
                            }))
                          );
                        }}
                        disabled={!aiEnhanceIsEditing}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a golden repository" />
                        </SelectTrigger>
                        <SelectContent>
                          {adoGoldenRepos.length === 0 ? (
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                              No repositories available
                            </div>
                          ) : (
                            adoGoldenRepos.map((repo) => (
                              <SelectItem key={repo.id} value={repo.id}>
                                {repo.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Choose the golden repository that contains
                      your AI Enhance guidelines.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Guideline Folder</Label>
                    {isLoadingTree && aiEnhanceRepoId ? (
                      <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Loading folder structure...
                        </span>
                      </div>
                    ) : (
                      <FolderPicker
                        value={aiEnhanceFolderPath || "/"}
                        onChange={(path) => {
                          if (!aiEnhanceRepoId || !aiEnhanceIsEditing) return;
                          setAiEnhanceFolderPath(path);
                          // Clear file paths when folder changes
                          setAiEnhanceLocationMappings((prev) =>
                            prev.map((m) => ({
                              ...m,
                              filePath: "",
                            }))
                          );
                        }}
                        repositoryTree={rawTreeNodes}
                        label="Browse folders"
                        disabled={!aiEnhanceIsEditing}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      Base folder in the golden repository where the guideline
                      markdown files live.
                    </p>
                  </div>
                </div>

                {/* Location → file mappings */}
                <div className="border rounded-md overflow-hidden">
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-muted text-xs font-medium">
                    <span>Location</span>
                    <span className="col-span-2">
                      Guideline File Path (relative to repo)
                    </span>
                  </div>
                  {isLoadingMappings ? (
                    <div className="flex items-center justify-center gap-2 py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Loading mappings...
                      </span>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {aiEnhanceLocationMappings.map((mapping) => {
                        const loc = AI_ENHANCE_LOCATIONS.find(
                          (l) => l.key === mapping.locationKey
                        );
                        return (
                          <div
                            key={mapping.locationKey}
                            className="grid grid-cols-3 gap-2 px-3 py-2 items-center"
                          >
                            <div className="space-y-1">
                              <div className="text-sm font-medium">
                                {loc?.label ?? mapping.locationKey}
                              </div>
                              {loc?.description && (
                                <div className="text-xs text-muted-foreground">
                                  {loc.description}
                                </div>
                              )}
                            </div>
                            <div className="col-span-2 flex items-center gap-2">
                              {isLoadingTree &&
                              aiEnhanceRepoId &&
                              aiEnhanceFolderPath ? (
                                <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted w-full">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">
                                    Loading files...
                                  </span>
                                </div>
                              ) : (
                                <Select
                                  value={mapping.filePath || undefined}
                                  onValueChange={(value) => {
                                    setAiEnhanceLocationMappings((prev) =>
                                      prev.map((m) =>
                                        m.locationKey === mapping.locationKey
                                          ? {
                                              ...m,
                                              filePath:
                                                value === "__clear__"
                                                  ? ""
                                                  : value,
                                            }
                                          : m
                                      )
                                    );
                                  }}
                                  disabled={
                                    !aiEnhanceIsEditing ||
                                    !aiEnhanceRepoId ||
                                    !aiEnhanceFolderPath ||
                                    fileOptions.length === 0 ||
                                    isLoadingTree
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue
                                      placeholder={
                                        !aiEnhanceRepoId || !aiEnhanceFolderPath
                                          ? "Select repository and folder first"
                                          : isLoadingTree
                                          ? "Loading files..."
                                          : mapping.filePath
                                          ? undefined
                                          : "Not mapped"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {mapping.filePath && (
                                      <>
                                        <SelectItem
                                          value="__clear__"
                                          className="text-muted-foreground italic"
                                        >
                                          <span className="flex items-center gap-2">
                                            <X className="h-3.5 w-3.5" />
                                            Clear selection (Not mapped)
                                          </span>
                                        </SelectItem>
                                        <div className="border-t my-1" />
                                      </>
                                    )}
                                    {fileOptions.length === 0 ? (
                                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                        No files available
                                      </div>
                                    ) : (
                                      fileOptions.map((file) => (
                                        <SelectItem
                                          key={file.path}
                                          value={file.path}
                                        >
                                          {file.name}
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              )}
                              {mapping.filePath && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    setAiEnhanceLocationMappings((prev) =>
                                      prev.map((m) =>
                                        m.locationKey === mapping.locationKey
                                          ? { ...m, filePath: "" }
                                          : m
                                      )
                                    );
                                  }}
                                  disabled={
                                    !aiEnhanceIsEditing ||
                                    !aiEnhanceRepoId ||
                                    !aiEnhanceFolderPath
                                  }
                                  title="Clear selection"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Client Settings Tab - Used by SDLC, Conversational UI, Workflow, and Hub Artifacts */}
          <TabsContent value="central" className="space-y-6">
            {patTokenExpired && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Token Expired</AlertTitle>
                <AlertDescription>
                  Token has expired please update it.
                </AlertDescription>
              </Alert>
            )}
            {jiraOnlyHosting && (
              <Alert>
                <AlertTitle className="text-foreground">Jira-only deployment</AlertTitle>
                <AlertDescription>
                  Azure DevOps organization settings are hidden. Configure Jira
                  connections below. Golden Repository settings are available in the Golden Repository tab.
                </AlertDescription>
              </Alert>
            )}
            {!isEncryptionAvailable && (
              <Alert
                variant="destructive"
                data-testid="alert-encryption-not-configured"
              >
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Encryption key not configured</AlertTitle>
                <AlertDescription>
                  Client Settings requires the{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">
                    PAT_ENCRYPTION_KEY
                  </code>{" "}
                  environment variable so organization tokens can be stored
                  securely. Set it in your environment (minimum 32 characters)
                  and restart the application.
                </AlertDescription>
              </Alert>
            )}

            <Card className="border-l-[3px] border-l-slate-500" data-testid="card-central-settings">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Client Settings</CardTitle>
                    <CardDescription>
                      Manage organization connections used by SDLC,
                      Conversational UI, Workflow, and Hub Artifacts
                    </CardDescription>
                  </div>
                  {isTenantAdmin && (
                    <Button
                      onClick={() => setAddOrgDialogOpen(true)}
                      size="sm"
                      disabled={!isEncryptionAvailable}
                      data-testid="button-add-organization-card"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Organization
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    ...(jiraOnlyHosting
                      ? []
                      : artifactsOrgs.map((org) => {
                          const name = formatArtifactOrgName(org);
                          return { ...org, name, type: "ado" as const };
                        })),
                    ...jiraConnections.map((conn: any) => ({
                      id: conn.id,
                      organizationUrl: conn.instanceUrl,
                      name: conn.name,
                      patConfigured: conn.hasToken ?? !!conn.apiTokenEncrypted,
                      isAdminConnection: Boolean(conn.isAdminConnection),
                      type: "jira" as const,
                    })),
                  ]
                    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                    .map((org) => (
                    <Card
                      key={org.id}
                      className="border-2 border-l-[3px] border-l-slate-500"
                      data-testid={`org-card-${org.id}`}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-lg">
                                {org.name || (org.type === "ado" ? "ADO Organization" : "Jira Instance")}
                              </CardTitle>
                              <Badge
                                variant="outline"
                                className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 flex items-center gap-1.5 rounded-full border shadow-sm transition-all duration-300 hover:scale-105 ${
                                  org.type === "ado"
                                    ? "bg-blue-500/10 text-blue-600 border-blue-200/50 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800/50"
                                    : "bg-orange-500/10 text-orange-600 border-orange-200/50 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-800/50"
                                }`}
                              >
                                {org.type === "ado" ? (
                                  <VscAzureDevops className="h-3 w-3" />
                                ) : (
                                  <SiJira className="h-3 w-3" />
                                )}
                                {org.type}
                              </Badge>
                              {org.type === "jira" && (org as any).isAdminConnection && (
                                <Badge
                                  variant="outline"
                                  className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 flex items-center gap-1 rounded-full border shadow-sm bg-emerald-500/10 text-emerald-600 border-emerald-200/50 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-800/50"
                                  data-testid={`badge-admin-connection-${org.id}`}
                                  title="Used for project creation (requires Administer Jira)"
                                >
                                  Admin
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <CardDescription className="text-sm">
                                {formatArtifactOrgDisplayUrl(org.organizationUrl)}
                              </CardDescription>
                              <OrganizationProjectCount orgId={org.id} type={org.type} />
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveOrganization(org.id)}
                            data-testid={`button-remove-org-${org.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">
                              Authentication Status
                            </Label>
                            <div className="flex items-center gap-2">
                              {org.patConfigured ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-2 py-0.5"
                                >
                                  <Check className="h-3 w-3 mr-1" />
                                  Configured
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="bg-red-100 text-red-700 hover:bg-red-100 border-none px-2 py-0.5"
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Not Configured
                                </Badge>
                              )}
                              {org.type === "ado" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleConfigurePAT(org.id)}
                                  data-testid={`button-configure-pat-${org.id}`}
                                >
                                  {org.patConfigured ? "Update PAT" : "Configure PAT"}
                                </Button>
                              )}
                              {org.type === "jira" && isTenantAdmin && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={
                                    setJiraAdminConnectionMutation.isPending ||
                                    !org.patConfigured
                                  }
                                  onClick={() =>
                                    setJiraAdminConnectionMutation.mutate({
                                      id: org.id,
                                      isAdmin: !((org as any).isAdminConnection),
                                    })
                                  }
                                  data-testid={`button-toggle-admin-conn-${org.id}`}
                                  title={
                                    (org as any).isAdminConnection
                                      ? "Stop using this connection for project creation"
                                      : "Use this connection for project creation (requires Administer Jira on its account)"
                                  }
                                >
                                  {(org as any).isAdminConnection
                                    ? "Unset Admin"
                                    : "Set as Admin"}
                                </Button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {org.type === "ado"
                              ? "Azure DevOps Personal Access Token (PAT) used to access repositories and work items."
                              : (org as any).isAdminConnection
                                ? "Jira API Token used to access issues and projects. This connection is also used for project creation (requires Administer Jira)."
                                : "Jira API Token used to access issues and projects."}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {(jiraOnlyHosting
                    ? jiraConnections.length === 0
                    : artifactsOrgs.length === 0 && jiraConnections.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>No organizations configured</p>
                      <p className="text-sm mt-2">
                        Click "Add Organization" to get started
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

          </TabsContent>
        </Tabs>

        <Dialog open={integrationDialogOpen} onOpenChange={closeIntegrationDialog}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>
                {(integrationDialogType === "datadog" ? datadogIntegration : serviceNowIntegration)
                  ? `Update ${getIntegrationLabel(integrationDialogType)} Configuration`
                  : `Add ${getIntegrationLabel(integrationDialogType)} Configuration`}
              </DialogTitle>
              <DialogDescription>
                {integrationDialogType === "datadog"
                  ? "Enter the Datadog API key and application key for this tenant."
                  : "Enter the ServiceNow instance details and credentials for this tenant."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {integrationDialogType === "datadog" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="settings-datadog-base-url">Datadog Site / Base URL</Label>
                    <Input
                      id="settings-datadog-base-url"
                      placeholder="https://api.us5.datadoghq.com"
                      value={integrationFormData.datadogBaseUrl}
                      onChange={(e) =>
                        setIntegrationFormData((prev) => ({
                          ...prev,
                          datadogBaseUrl: e.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Examples: `https://api.datadoghq.com`, `https://api.us5.datadoghq.com`, `https://api.datadoghq.eu`
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-datadog-api-key">API Key</Label>
                    <Input
                      id="settings-datadog-api-key"
                      type="password"
                      placeholder="Paste your Datadog API key"
                      value={integrationFormData.datadogApiKey}
                      onChange={(e) =>
                        setIntegrationFormData((prev) => ({
                          ...prev,
                          datadogApiKey: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-datadog-app-key">Application Key</Label>
                    <Input
                      id="settings-datadog-app-key"
                      type="password"
                      placeholder="Paste your Datadog application key"
                      value={integrationFormData.datadogAppKey}
                      onChange={(e) =>
                        setIntegrationFormData((prev) => ({
                          ...prev,
                          datadogAppKey: e.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="settings-servicenow-base-url">Instance Base URL</Label>
                    <Input
                      id="settings-servicenow-base-url"
                      placeholder="https://dev12345.service-now.com"
                      value={integrationFormData.serviceNowBaseUrl}
                      onChange={(e) =>
                        setIntegrationFormData((prev) => ({
                          ...prev,
                          serviceNowBaseUrl: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-servicenow-username">Username</Label>
                    <Input
                      id="settings-servicenow-username"
                      placeholder="admin"
                      value={integrationFormData.serviceNowUsername}
                      onChange={(e) =>
                        setIntegrationFormData((prev) => ({
                          ...prev,
                          serviceNowUsername: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-servicenow-password">Password</Label>
                    <Input
                      id="settings-servicenow-password"
                      type="password"
                      placeholder="Enter your ServiceNow password"
                      value={integrationFormData.serviceNowPassword}
                      onChange={(e) =>
                        setIntegrationFormData((prev) => ({
                          ...prev,
                          serviceNowPassword: e.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => closeIntegrationDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={() => saveIntegrationMutation.mutate()} disabled={saveIntegrationMutation.isPending}>
                  {saveIntegrationMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Configuration"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={!!integrationToDelete}
          onOpenChange={(open) => {
            if (!open) setIntegrationToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete integration configuration?</AlertDialogTitle>
              <AlertDialogDescription>
                {integrationToDelete
                  ? `This will remove the saved ${getIntegrationLabel(integrationToDelete.integrationType)} credentials for this tenant.`
                  : "This will remove the saved integration credentials for this tenant."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIntegrationToDelete(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (integrationToDelete) {
                    deleteIntegrationMutation.mutate(integrationToDelete.integrationType);
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteIntegrationMutation.isPending}
              >
                {deleteIntegrationMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Configure PAT Dialog */}
        <Dialog
          open={configurePATDialogOpen}
          onOpenChange={setConfigurePATDialogOpen}
        >
          <DialogContent data-testid="dialog-configure-pat">
            <DialogHeader>
              <DialogTitle>Configure Personal Access Token</DialogTitle>
              <DialogDescription>
                Enter the PAT token for{" "}
                {formatArtifactOrgName(
                  artifactsOrgs.find((org) => org.id === editingOrgId)
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pat-token">Personal Access Token</Label>
                <Input
                  id="pat-token"
                  type="password"
                  placeholder="Enter your Azure DevOps PAT token"
                  value={patTokenInput}
                  onChange={(e) => setPATTokenInput(e.target.value)}
                  data-testid="input-configure-pat"
                />
                <p className="text-xs text-muted-foreground">
                  This token will be securely stored and used to access
                  artifacts from this organization.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfigurePATDialogOpen(false);
                    setEditingOrgId(null);
                    setPATTokenInput("");
                  }}
                  data-testid="button-cancel-configure-pat"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSavePAT}
                  data-testid="button-save-pat"
                  disabled={updateArtifactOrgMutation.isPending}
                >
                  {updateArtifactOrgMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save PAT Token"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AddOrganizationDialog
          open={addOrgDialogOpen}
          onOpenChange={setAddOrgDialogOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/artifact-organizations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
          }}
        />

        {/* Add Golden Repo Source Dialog */}
        <GenericModal
          open={addGoldenRepoDialogOpen}
          onOpenChange={(open) => {
            setAddGoldenRepoDialogOpen(open);
            if (!open) resetGoldenRepoForm();
          }}
          title="Configure Golden Repo Source"
          description="Select a Git provider and configure it as the source for golden repository templates"
          icon={Plus}
          iconClassName="bg-gradient-to-br from-green-500 to-green-600"
          contentClassName="space-y-4"
          footerContent={
            goldenRepoFooterError ? (
              <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{goldenRepoFooterError}</span>
              </div>
            ) : null
          }
          footerButtons={[
            {
              label: "Cancel",
              onClick: () => { setAddGoldenRepoDialogOpen(false); resetGoldenRepoForm(); },
              variant: "outline",
              "data-testid": "button-cancel-add-golden-repo-org",
            },
            {
              label: createGoldenRepoOrgMutation.isPending ? "Validating..." : "Validate and Save",
              onClick: handleAddGoldenRepo,
              disabled: createGoldenRepoOrgMutation.isPending,
              loading: createGoldenRepoOrgMutation.isPending,
              "data-testid": "button-confirm-add-golden-repo-org",
            },
          ]}
        >
          <div className="space-y-4" onChange={() => goldenRepoFooterError && setGoldenRepoFooterError(null)}>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={goldenRepoProvider} onValueChange={(v) => { setGoldenRepoProvider(v as GoldenRepoProvider); resetGoldenRepoForm(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="gitlab">GitLab</SelectItem>
                  <SelectItem value="ado">Azure DevOps Git</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(goldenRepoProvider === "github" || goldenRepoProvider === "gitlab") && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-name">Display Name (optional)</Label>
                  <Input id="golden-repo-name" placeholder="e.g., My Golden Repos" value={goldenRepoFormData.name} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, name: e.target.value })} />
                </div>
                {goldenRepoProvider === "gitlab" && (
                  <div className="space-y-2">
                    <Label htmlFor="golden-repo-baseurl">GitLab URL</Label>
                    <Input id="golden-repo-baseurl" placeholder="https://gitlab.com" value={goldenRepoFormData.baseUrl} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, baseUrl: e.target.value })} />
                    <p className="text-xs text-muted-foreground">Leave as default for gitlab.com, or enter your self-hosted URL</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-owner">{goldenRepoProvider === "github" ? "Owner / Organization" : "Group or User Namespace"}</Label>
                  <Input id="golden-repo-owner" placeholder={goldenRepoProvider === "github" ? "e.g., DevXPlatform" : "e.g., my-org or group ID"} value={goldenRepoFormData.ownerOrGroup} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, ownerOrGroup: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-token">Personal Access Token</Label>
                  <Input id="golden-repo-token" type="password" placeholder={goldenRepoProvider === "github" ? "ghp_..." : "glpat-..."} value={goldenRepoFormData.accessToken} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, accessToken: e.target.value })} />
                  <p className="text-xs text-muted-foreground">
                    {goldenRepoProvider === "github" ? "Needs `repo` scope" : "Needs `read_api` scope"}. Token is encrypted and stored securely.
                  </p>
                </div>
              </>
            )}

            {goldenRepoProvider === "ado" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-name">Organization Name</Label>
                  <Input id="golden-repo-name" placeholder="e.g., NOUSBLR" value={goldenRepoFormData.name} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, name: e.target.value })} data-testid="input-golden-repo-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-url">Organization URL</Label>
                  <Input id="golden-repo-url" placeholder="https://dev.azure.com/YourOrg" value={goldenRepoFormData.organizationUrl} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, organizationUrl: e.target.value })} data-testid="input-golden-repo-url" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-project">Project Name</Label>
                  <Input id="golden-repo-project" placeholder="e.g., GSS-COC-DEVX-FOCUS" value={goldenRepoFormData.projectName} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, projectName: e.target.value })} data-testid="input-golden-repo-project" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-repository">Repository Name (Optional)</Label>
                  <Input id="golden-repo-repository" placeholder="Leave empty for default" value={goldenRepoFormData.repositoryName} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, repositoryName: e.target.value })} data-testid="input-golden-repo-repository" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-api-version">API Version</Label>
                  <Input id="golden-repo-api-version" placeholder="7.1" value={goldenRepoFormData.apiVersion} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, apiVersion: e.target.value })} data-testid="input-golden-repo-api-version" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golden-repo-pat">Personal Access Token</Label>
                  <Input id="golden-repo-pat" type="password" placeholder="Enter your Azure DevOps PAT token" value={goldenRepoFormData.patToken} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, patToken: e.target.value })} data-testid="input-golden-repo-pat" />
                  <p className="text-xs text-muted-foreground">This token will be encrypted and securely stored.</p>
                </div>
              </>
            )}
          </div>
        </GenericModal>

        {/* Edit Golden Repo Source Dialog */}
        <GenericModal
          open={editGoldenRepoDialogOpen}
          onOpenChange={(open) => {
            setEditGoldenRepoDialogOpen(open);
            if (!open) {
              setEditingGoldenRepoId(null);
              resetGoldenRepoForm();
            }
          }}
          title="Edit Golden Repo Source"
          description="Update the golden repository source configuration"
          icon={SettingsIcon}
          iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
          contentClassName="space-y-4"
          footerContent={
            goldenRepoFooterError ? (
              <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{goldenRepoFooterError}</span>
              </div>
            ) : null
          }
          footerButtons={[
            {
              label: "Cancel",
              onClick: () => { setEditGoldenRepoDialogOpen(false); setEditingGoldenRepoId(null); resetGoldenRepoForm(); },
              variant: "outline",
              "data-testid": "button-cancel-edit-golden-repo-org",
            },
            {
              label: updateGoldenRepoOrgMutation.isPending ? "Validating..." : "Validate and Update",
              onClick: handleUpdateGoldenRepo,
              disabled: updateGoldenRepoOrgMutation.isPending,
              loading: updateGoldenRepoOrgMutation.isPending,
              "data-testid": "button-confirm-edit-golden-repo-org",
            },
          ]}
        >
          <div className="space-y-4" onChange={() => goldenRepoFooterError && setGoldenRepoFooterError(null)}>
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">
                {goldenRepoProvider === "github" ? "GitHub" : goldenRepoProvider === "gitlab" ? "GitLab" : "Azure DevOps"}
              </div>
            </div>

            {(goldenRepoProvider === "github" || goldenRepoProvider === "gitlab") && (
              <>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input placeholder="e.g., My Golden Repos" value={goldenRepoFormData.name} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, name: e.target.value })} />
                </div>
                {goldenRepoProvider === "gitlab" && (
                  <div className="space-y-2">
                    <Label>GitLab URL</Label>
                    <Input placeholder="https://gitlab.com" value={goldenRepoFormData.baseUrl} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, baseUrl: e.target.value })} />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{goldenRepoProvider === "github" ? "Owner / Organization" : "Group or User Namespace"}</Label>
                  <Input placeholder={goldenRepoProvider === "github" ? "e.g., DevXPlatform" : "e.g., my-org"} value={goldenRepoFormData.ownerOrGroup} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, ownerOrGroup: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Personal Access Token</Label>
                  <Input type="password" placeholder="Leave empty to keep current token" value={goldenRepoFormData.accessToken} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, accessToken: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Leave empty to keep the current token.</p>
                </div>
              </>
            )}

            {goldenRepoProvider === "ado" && (
              <>
                <div className="space-y-2">
                  <Label>Organization Name</Label>
                  <Input placeholder="e.g., NOUSBLR" value={goldenRepoFormData.name} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, name: e.target.value })} data-testid="input-edit-golden-repo-name" />
                </div>
                <div className="space-y-2">
                  <Label>Organization URL</Label>
                  <Input placeholder="https://dev.azure.com/YourOrg" value={goldenRepoFormData.organizationUrl} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, organizationUrl: e.target.value })} data-testid="input-edit-golden-repo-url" />
                </div>
                <div className="space-y-2">
                  <Label>Project Name</Label>
                  <Input placeholder="e.g., GSS-COC-DEVX-FOCUS" value={goldenRepoFormData.projectName} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, projectName: e.target.value })} data-testid="input-edit-golden-repo-project" />
                </div>
                <div className="space-y-2">
                  <Label>Repository Name (Optional)</Label>
                  <Input placeholder="Leave empty for default" value={goldenRepoFormData.repositoryName} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, repositoryName: e.target.value })} data-testid="input-edit-golden-repo-repository" />
                </div>
                <div className="space-y-2">
                  <Label>API Version</Label>
                  <Input placeholder="7.1" value={goldenRepoFormData.apiVersion} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, apiVersion: e.target.value })} data-testid="input-edit-golden-repo-api-version" />
                </div>
                <div className="space-y-2">
                  <Label>Personal Access Token</Label>
                  <Input type="password" placeholder="Leave empty to keep current token" value={goldenRepoFormData.patToken} onChange={(e) => setGoldenRepoFormData({ ...goldenRepoFormData, patToken: e.target.value })} data-testid="input-edit-golden-repo-pat" />
                  <p className="text-xs text-muted-foreground">Leave empty to keep the current PAT token.</p>
                </div>
              </>
            )}
          </div>
        </GenericModal>

        {/* Delete Organization Confirmation Dialog */}
        <AlertDialog
          open={deleteConfirmDialogOpen}
          onOpenChange={setDeleteConfirmDialogOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Organization?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to disconnect this organization? This
                action cannot be undone and you will need to reconfigure the
                organization to use it again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setDeleteConfirmDialogOpen(false);
                  setOrgToDelete(null);
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteOrganization}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </div>
  );
}
